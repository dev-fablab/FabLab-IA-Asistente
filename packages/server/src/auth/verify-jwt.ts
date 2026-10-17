import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { logger } from '../logger';

export type JwtVerifierConfig = {
  /** URL del proyecto Supabase, por ejemplo https://<ref>.supabase.co */
  supabaseUrl: string;
  /** Solo si el proyecto firma con clave simétrica (HS256). */
  jwtSecret?: string;
  /** Emisor esperado; por defecto `<supabaseUrl>/auth/v1`. */
  issuer?: string;
  /** Resolver de claves alternativo (pruebas); por defecto el JWKS remoto del proyecto. */
  keyResolver?: JWTVerifyGetKey;
};

const ASYMMETRIC_ALGORITHMS = ['ES256', 'RS256'];

/**
 * Verifica los JWT de Supabase Auth contra las claves públicas del proyecto (JWKS) o,
 * en proyectos con clave simétrica, contra el secreto JWT. Exige la audiencia
 * `authenticated`, de modo que la clave pública (`anon`) nunca pasa.
 */
export function createJwtVerifier(config: JwtVerifierConfig) {
  const issuer = config.issuer ?? `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const keyResolver =
    config.keyResolver ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const secret = config.jwtSecret ? new TextEncoder().encode(config.jwtSecret) : undefined;

  return async function verifyToken(token: string): Promise<{ userId: string } | null> {
    // Un token que ni siquiera tiene forma de JWT es ruido de cualquiera: no se registra.
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      return null;
    }

    try {
      const options = { issuer, audience: 'authenticated' };

      let subject: string | undefined;
      if (alg === 'HS256') {
        if (!secret) return null;
        subject = (await jwtVerify(token, secret, { ...options, algorithms: ['HS256'] })).payload.sub;
      } else {
        subject = (
          await jwtVerify(token, keyResolver, { ...options, algorithms: ASYMMETRIC_ALGORITHMS })
        ).payload.sub;
      }
      return subject ? { userId: subject } : null;
    } catch (error) {
      // Un token inválido es esperable; cualquier otra falla se registra.
      if (!(error instanceof errors.JOSEError)) {
        logger.warn('jwt.verify_failed', { reason: error instanceof Error ? error.message : String(error) });
      }
      return null;
    }
  };
}
