import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createJwtVerifier } from '../src/auth/verify-jwt';

const SUPABASE_URL = 'http://localhost:54321';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let privateKey: SigningKey;
let verify: ReturnType<typeof createJwtVerifier>;

async function sign(
  claims: { sub?: string; iss?: string; aud?: string; exp?: string } = {},
  key: SigningKey = privateKey,
) {
  const jwt = new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? 'authenticated')
    .setExpirationTime(claims.exp ?? '1h');
  if (claims.sub !== undefined || !('sub' in claims)) jwt.setSubject(claims.sub ?? 'user-1');
  return jwt.sign(key);
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256' };
  verify = createJwtVerifier({
    supabaseUrl: SUPABASE_URL,
    keyResolver: createLocalJWKSet({ keys: [jwk] }),
  });
});

describe('createJwtVerifier', () => {
  it('acepta un token firmado por el proyecto', async () => {
    expect(await verify(await sign())).toEqual({ userId: 'user-1' });
  });

  it('rechaza un token vencido', async () => {
    expect(await verify(await sign({ exp: '-1m' }))).toBeNull();
  });

  it('rechaza otro emisor', async () => {
    expect(await verify(await sign({ iss: 'https://otro.supabase.co/auth/v1' }))).toBeNull();
  });

  it('rechaza la audiencia anon (la clave pública no sirve como sesión)', async () => {
    expect(await verify(await sign({ aud: 'anon' }))).toBeNull();
  });

  it('rechaza un token firmado con otra clave', async () => {
    const other = await generateKeyPair('ES256');
    expect(await verify(await sign({}, other.privateKey))).toBeNull();
  });

  it('rechaza un token manipulado', async () => {
    const token = await sign();
    const [header, payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'otro', iss: ISSUER, aud: 'authenticated' })).toString('base64url');
    expect(payload).not.toBe(forged);
    expect(await verify(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it('rechaza un token sin sujeto', async () => {
    expect(await verify(await sign({ sub: undefined }))).toBeNull();
  });

  it('rechaza basura y alg=none', async () => {
    expect(await verify('no-es-un-jwt')).toBeNull();
    const none = [
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'x', iss: ISSUER, aud: 'authenticated' })).toString('base64url'),
      '',
    ].join('.');
    expect(await verify(none)).toBeNull();
  });

  describe('proyecto con clave simétrica (HS256)', () => {
    const hsToken = (secret: string) =>
      new SignJWT({ role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-hs')
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(secret));

    it('acepta HS256 solo si hay secreto configurado y coincide', async () => {
      const withSecret = createJwtVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: SECRET });
      expect(await withSecret(await hsToken(SECRET))).toEqual({ userId: 'user-hs' });
      expect(await withSecret(await hsToken('otro-secreto-de-al-menos-32-caracteres!!'))).toBeNull();
    });

    it('rechaza HS256 cuando no hay secreto configurado', async () => {
      expect(await verify(await hsToken(SECRET))).toBeNull();
    });
  });
});
