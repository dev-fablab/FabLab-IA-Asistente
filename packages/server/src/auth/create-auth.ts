import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { getDb, users, type Database } from '@fablab/db';
import * as schema from '@fablab/db/schema';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { logger } from '../logger';
import { DOMAIN_ERROR, LOGIN_ERROR, isSeedEmail, isStaffDomainEmail, normalizeStaffEmail } from './domain';
import { accessControl, authRoles } from './permissions';
import { upsertProfile } from './profile';
import { whenSeeded } from './seed-state';

type EndpointContext = {
  body?: { userId?: unknown };
  context?: { session?: { user?: { id?: string } } | null };
} | null;

function userIdFrom(context: EndpointContext): string | undefined {
  const fromBody = context?.body?.userId;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  const fromSession = context?.context?.session?.user?.id;
  return typeof fromSession === 'string' && fromSession.length > 0 ? fromSession : undefined;
}

async function emailOf(userId: string): Promise<string | null> {
  const [row] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, userId));
  return row?.email ?? null;
}

function requireDomain(email: unknown): string {
  if (typeof email !== 'string') throw new APIError('BAD_REQUEST', { message: DOMAIN_ERROR });
  const normalized = normalizeStaffEmail(email);
  if (!isStaffDomainEmail(normalized)) throw new APIError('BAD_REQUEST', { message: DOMAIN_ERROR });
  return normalized;
}

/**
 * Instancia de Better Auth: correo y contraseña, registro público cerrado,
 * solo `@inacapmail.cl`, roles `admin` y `staff`.
 *
 * El hash de la contraseña lo escribe Better Auth en `accounts.password`.
 * No se guarda la contraseña en claro.
 */
export function createAuth(db: Database) {
  return betterAuth({
    appName: 'Fab Lab',
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
    },
    user: { modelName: 'users' },
    session: { modelName: 'sessions' },
    account: { modelName: 'accounts' },
    verification: { modelName: 'verifications' },
    advanced: {
      database: { generateId: 'uuid' },
    },
    // `modelName` ya es plural. `usePlural` lo volvería a pluralizar (`userss`).
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
      usePlural: false,
    }),
    plugins: [
      admin({
        ac: accessControl,
        roles: authRoles,
        defaultRole: 'staff',
        adminRoles: ['admin'],
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = requireDomain(user.email);
            return { data: { ...user, email } };
          },
          after: async (user) => {
            await upsertProfile(user);
          },
        },
        update: {
          before: async (data, context) => {
            if (data.email === undefined) return;
            const email = requireDomain(data.email);
            const userId = userIdFrom(context as EndpointContext);
            if (userId) {
              const current = await emailOf(userId);
              if (current && isSeedEmail(current) && current !== email) {
                throw new APIError('BAD_REQUEST', {
                  message: 'No se puede cambiar el correo de una cuenta predeterminada',
                });
              }
            }
            return { data: { ...data, email } };
          },
          after: async (user) => {
            await upsertProfile(user);
          },
        },
        delete: {
          before: async (user) => {
            if (isSeedEmail(user.email)) {
              throw new APIError('BAD_REQUEST', {
                message: 'No se puede eliminar una cuenta predeterminada',
              });
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        await whenSeeded();
        const raw = typeof ctx.body?.email === 'string' ? ctx.body.email : '';
        if (!isStaffDomainEmail(raw)) {
          throw new APIError('UNAUTHORIZED', { message: LOGIN_ERROR });
        }
      }),
    },
    logger: {
      level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'warn',
      log: (level, message, ...args) => {
        const text = typeof message === 'string' ? message : 'better-auth';
        if (level === 'error') logger.error('auth.library', undefined, { message: text });
        else if (level === 'warn') logger.warn('auth.library', { message: text });
        else logger.debug('auth.library', { message: text, args: args.length });
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
