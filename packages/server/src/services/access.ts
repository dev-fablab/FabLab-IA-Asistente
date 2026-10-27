import { getDb, users, type ProfileRole } from '@fablab/db';
import { APIError } from 'better-auth/api';
import { count, eq } from 'drizzle-orm';
import { badRequest, forbidden, notFound } from '../errors';
import { getAuth } from '../auth/instance';
import { DOMAIN_ERROR, emailLocalPart, isSeedEmail, isStaffDomainEmail, normalizeStaffEmail } from '../auth/domain';
import { toProfileRole } from '../auth/profile';

export type AccessUser = {
  id: string;
  email: string;
  role: ProfileRole;
  createdAt: string;
};

type AccessInput = {
  email: string;
  role: ProfileRole;
  password?: string;
};

function spanishAuthMessage(message: string): string {
  if (/already exists/i.test(message)) return 'Ese correo ya tiene acceso';
  if (/not found/i.test(message)) return 'No se encontró la cuenta';
  if (/not allowed|forbidden/i.test(message)) return 'No tienes permiso para esta acción';
  if (message === DOMAIN_ERROR || message.startsWith('No se puede') || message.startsWith('Debe quedar')) return message;
  return message;
}

function rethrowAuth(error: unknown): never {
  if (error instanceof APIError) {
    const message = spanishAuthMessage(error.message);
    if (error.statusCode === 403) throw forbidden(message);
    if (error.statusCode === 404) throw notFound(message);
    throw badRequest(message);
  }
  throw error;
}

function present(user: { id: string; email: string; role?: string | null; createdAt: Date | string }): AccessUser {
  const createdAt = user.createdAt instanceof Date ? user.createdAt.toISOString() : new Date(user.createdAt).toISOString();
  return { id: user.id, email: user.email, role: toProfileRole(user.role), createdAt };
}

async function adminCount(): Promise<number> {
  const [row] = await getDb().select({ total: count() }).from(users).where(eq(users.role, 'admin'));
  return row?.total ?? 0;
}

async function readUser(headers: Headers, id: string): Promise<AccessUser> {
  try {
    const user = await getAuth().api.getUser({ query: { id }, headers });
    if (!user) throw notFound('No se encontró la cuenta');
    return present(user);
  } catch (error) {
    if (error instanceof APIError) rethrowAuth(error);
    throw error;
  }
}

export async function listAccessUsers(headers: Headers): Promise<AccessUser[]> {
  try {
    const result = await getAuth().api.listUsers({
      query: { limit: 100, sortBy: 'email', sortDirection: 'asc' },
      headers,
    });
    return result.users.map((user) => present(user));
  } catch (error) {
    rethrowAuth(error);
  }
}

export async function createAccessUser(headers: Headers, input: AccessInput): Promise<AccessUser> {
  const email = normalizeStaffEmail(input.email);
  if (!isStaffDomainEmail(email)) throw badRequest(DOMAIN_ERROR);
  if (!input.password || input.password.length < 12) {
    throw badRequest('La contraseña debe tener al menos 12 caracteres');
  }
  try {
    const created = await getAuth().api.createUser({
      body: { email, password: input.password, name: emailLocalPart(email), role: input.role },
      headers,
    });
    return present(created.user);
  } catch (error) {
    rethrowAuth(error);
  }
}

export async function updateAccessUser(headers: Headers, id: string, input: AccessInput): Promise<AccessUser> {
  const current = await readUser(headers, id);
  const email = normalizeStaffEmail(input.email);
  if (!isStaffDomainEmail(email)) throw badRequest(DOMAIN_ERROR);
  if (isSeedEmail(current.email) && email !== current.email) {
    throw badRequest('No se puede cambiar el correo de una cuenta predeterminada');
  }
  if (current.role === 'admin' && input.role !== 'admin' && (await adminCount()) <= 1) {
    throw badRequest('Debe quedar al menos un administrador');
  }
  if (input.password && input.password.length > 0 && input.password.length < 12) {
    throw badRequest('La contraseña debe tener al menos 12 caracteres');
  }

  try {
    const auth = getAuth();
    if (email !== current.email) {
      await auth.api.adminUpdateUser({
        body: { userId: id, data: { email, name: emailLocalPart(email) } },
        headers,
      });
    }
    if (input.role !== current.role) {
      await auth.api.setRole({ body: { userId: id, role: input.role }, headers });
    }
    if (input.password && input.password.length > 0) {
      await auth.api.setUserPassword({ body: { userId: id, newPassword: input.password }, headers });
    }
  } catch (error) {
    rethrowAuth(error);
  }

  return readUser(headers, id);
}

export async function deleteAccessUser(headers: Headers, id: string, actorId: string): Promise<void> {
  const current = await readUser(headers, id);
  if (current.id === actorId) throw badRequest('No puedes eliminar tu propia cuenta');
  if (isSeedEmail(current.email)) throw badRequest('No se puede eliminar una cuenta predeterminada');
  if (current.role === 'admin' && (await adminCount()) <= 1) {
    throw badRequest('Debe quedar al menos un administrador');
  }
  try {
    await getAuth().api.removeUser({ body: { userId: id }, headers });
  } catch (error) {
    rethrowAuth(error);
  }
}
