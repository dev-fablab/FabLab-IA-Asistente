/**
 * Crea las dos cuentas del panel en local (producción y staging lo hacen solas al arrancar).
 *
 *   pnpm db:seed-admin
 *
 * Lee SEED_ADMIN_PASSWORD y SEED_STAFF_PASSWORD (mínimo 12 caracteres) de apps/web/.env.local.
 * Si la cuenta ya existe, no cambia su contraseña. Si el rol se desvió, lo corrige.
 */
import { closeDb } from '@fablab/db';
import { ensureDefaultUsers } from '../src/auth/seed';
import { getAuth } from '../src/auth/instance';

try {
  await ensureDefaultUsers(getAuth(), { force: true });
  console.log('Cuentas predeterminadas listas: admin@inacapmail.cl y staff@inacapmail.cl');
} finally {
  await closeDb();
}
