import { getDb } from '@fablab/db';
import { createAuth, type Auth } from './create-auth';
import { ensureDefaultUsers } from './seed';
import { registerSeed, whenSeeded } from './seed-state';

let auth: Auth | undefined;

/**
 * Better Auth se crea al primer uso. Importar el paquete (por ejemplo en `next build`)
 * no exige `BETTER_AUTH_SECRET` ni `DATABASE_URL`.
 */
export function getAuth(): Auth {
  auth ??= createAuth(getDb());
  return auth;
}

registerSeed(() => ensureDefaultUsers(getAuth()));

export { whenSeeded };
