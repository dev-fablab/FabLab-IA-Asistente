import { getDb, profiles } from '@fablab/db';
import { eq } from 'drizzle-orm';
import type { AuthDeps, StaffContext } from '../types';
import { getAuth } from './instance';
import { whenSeeded } from './seed-state';

async function findProfile(userId: string): Promise<StaffContext | null> {
  const [row] = await getDb()
    .select({ id: profiles.id, email: profiles.email, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId));
  return row ?? null;
}

/**
 * Dependencias de autenticación reales. La sesión se lee al atender la petición,
 * así construir la app (por ejemplo en `next build`) no exige las variables de entorno.
 */
export function createDefaultAuthDeps(): AuthDeps {
  return {
    async getUserId(headers) {
      await whenSeeded();
      const session = await getAuth().api.getSession({ headers });
      return session?.user.id ?? null;
    },
    findProfile,
  };
}
