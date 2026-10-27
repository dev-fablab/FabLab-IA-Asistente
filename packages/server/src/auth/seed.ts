import { getDb, users } from '@fablab/db';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { logger } from '../logger';
import type { Auth } from './create-auth';
import { ADMIN_EMAIL, STAFF_EMAIL, emailLocalPart } from './domain';
import { upsertProfile } from './profile';

const MIN_PASSWORD_LENGTH = 12;

const DEFAULT_USERS = [
  { email: ADMIN_EMAIL, role: 'admin', passwordEnv: 'SEED_ADMIN_PASSWORD' },
  { email: STAFF_EMAIL, role: 'staff', passwordEnv: 'SEED_STAFF_PASSWORD' },
] as const;

type SeedUser = (typeof DEFAULT_USERS)[number];

/** Solo producción y staging crean las dos cuentas al arrancar. En local se usa el script. */
export function shouldSeedDefaults(): boolean {
  const env = process.env.APP_ENV || process.env.VERCEL_ENV;
  return env === 'production' || env === 'staging';
}

function passwordFor(seed: SeedUser): string | null {
  const password = process.env[seed.passwordEnv];
  if (!password || password.length < MIN_PASSWORD_LENGTH) return null;
  return password;
}

function alreadyExists(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  return /already exists/i.test(error.message);
}

async function findUser(email: string) {
  const [row] = await getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.email, email));
  return row ?? null;
}

/**
 * Crea `admin@inacapmail.cl` y `staff@inacapmail.cl` si faltan.
 * No cambia la contraseña de quien ya existe. Si el rol se desvió, lo corrige.
 * Sin contraseña en el entorno registra el error y sigue: la API no se cae ni inventa una clave.
 */
export async function ensureDefaultUsers(auth: Auth, options?: { force?: boolean }): Promise<void> {
  if (!options?.force && !shouldSeedDefaults()) return;

  for (const seed of DEFAULT_USERS) {
    let user = await findUser(seed.email);
    if (!user) {
      const password = passwordFor(seed);
      if (!password) {
        logger.error('auth.seed.password', new Error(`Falta ${seed.passwordEnv} o tiene menos de 12 caracteres`), {
          email: seed.email,
        });
        continue;
      }
      try {
        const created = await auth.api.createUser({
          body: {
            email: seed.email,
            password,
            name: emailLocalPart(seed.email),
            role: seed.role,
          },
        });
        user = {
          id: created.user.id,
          email: created.user.email,
          name: created.user.name,
          role: created.user.role ?? seed.role,
        };
      } catch (error) {
        if (!alreadyExists(error)) throw error;
        user = await findUser(seed.email);
        if (!user) throw error;
      }
    }

    if (user.role !== seed.role) {
      await getDb().update(users).set({ role: seed.role, updatedAt: new Date() }).where(eq(users.id, user.id));
    }
    await upsertProfile({ id: user.id, email: user.email, role: seed.role });
  }
}
