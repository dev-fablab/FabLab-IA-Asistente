import { getDb, profiles } from '@fablab/db';
import { eq } from 'drizzle-orm';
import type { AuthDeps, StaffContext } from '../types';
import { createJwtVerifier } from './verify-jwt';

async function findProfile(userId: string): Promise<StaffContext | null> {
  const [row] = await getDb()
    .select({ id: profiles.id, email: profiles.email, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId));
  return row ?? null;
}

/**
 * Dependencias de autenticación reales. Se crean de forma perezosa para que construir
 * la app (por ejemplo en `next build`) no exija las variables de entorno.
 */
export function createDefaultAuthDeps(): AuthDeps {
  let verifier: ReturnType<typeof createJwtVerifier> | undefined;

  return {
    verifyToken(token) {
      if (!verifier) {
        const supabaseUrl = process.env.SUPABASE_URL;
        if (!supabaseUrl) throw new Error('SUPABASE_URL no está definida');
        verifier = createJwtVerifier({
          supabaseUrl,
          jwtSecret: process.env.SUPABASE_JWT_SECRET || undefined,
          issuer: process.env.SUPABASE_JWT_ISSUER || undefined,
        });
      }
      return verifier(token);
    },
    findProfile,
  };
}
