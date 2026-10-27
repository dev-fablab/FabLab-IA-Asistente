import { randomUUID } from 'node:crypto';
import { accounts, getDb, profiles, users } from '@fablab/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { ADMIN_EMAIL, STAFF_EMAIL } from '../src/auth/domain';
import { getAuth } from '../src/auth/instance';
import { ensureDefaultUsers } from '../src/auth/seed';
import { createTestUser, type TestUser } from './helpers/integration';

const app = createApp({ basePath: '/api' });

let admin: TestUser;
let staff: TestUser;
const createdIds: string[] = [];

beforeAll(async () => {
  admin = await createTestUser('admin');
  staff = await createTestUser('staff');
});

afterAll(async () => {
  for (const id of createdIds) await getDb().delete(users).where(eq(users.id, id));
  await staff.remove();
  await admin.remove();
});

const jsonHeaders = (user: TestUser) => ({ cookie: user.cookie, 'content-type': 'application/json' });

describe('dominio en Better Auth', () => {
  it('el inicio de sesión de otro dominio responde el mensaje genérico', async () => {
    const response = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'ana@otro.cl', password: 'clave-larga-de-prueba' }),
    });
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).toContain('Correo o contraseña incorrectos.');
  });

  it('crear un correo fuera del dominio responde 400', async () => {
    await expect(
      getAuth().api.createUser({
        body: { email: 'a@inacapmail.cl.evil.com', password: 'clave-larga-de-prueba', name: 'a', role: 'staff' },
      }),
    ).rejects.toThrow(/inacapmail\.cl/);
  });
});

describe('rutas de accesos', () => {
  it('el personal recibe 403 y el listado no incluye contraseñas', async () => {
    const denied = await app.request('/api/admin/users', { headers: { cookie: staff.cookie } });
    expect(denied.status).toBe(403);

    const list = await app.request('/api/admin/users', { headers: { cookie: admin.cookie } });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { users: { email: string; role: string }[] };
    expect(JSON.stringify(body)).not.toMatch(/password/i);
    expect(body.users.find((user) => user.email === staff.email)?.role).toBe('staff');
  });

  it('rechaza un dominio ajeno', async () => {
    const response = await app.request('/api/admin/users', {
      method: 'POST',
      headers: jsonHeaders(admin),
      body: JSON.stringify({ email: 'persona@otro.cl', password: 'clave-larga-de-prueba', role: 'staff' }),
    });
    expect(response.status).toBe(400);
  });

  it('vincula un acceso, permite entrar y el cambio de rol llega a profiles', async () => {
    const email = `it-acceso-${randomUUID().slice(0, 8)}@inacapmail.cl`;
    const password = 'clave-de-acceso-12';
    const created = await app.request('/api/admin/users', {
      method: 'POST',
      headers: jsonHeaders(admin),
      body: JSON.stringify({ email, password, role: 'staff' }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { user: { id: string; email: string; role: string; password?: string } };
    createdIds.push(body.user.id);
    expect(body.user).toMatchObject({ email, role: 'staff' });
    expect(body.user.password).toBeUndefined();

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    expect((await app.request('/api/admin/users', { headers: { cookie } })).status).toBe(403);

    const patched = await app.request(`/api/admin/users/${body.user.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(admin),
      body: JSON.stringify({ email, role: 'admin', password: '' }),
    });
    expect(patched.status).toBe(200);
    const [profile] = await getDb().select({ role: profiles.role }).from(profiles).where(eq(profiles.id, body.user.id));
    expect(profile?.role).toBe('admin');
    expect((await app.request('/api/admin/users', { headers: { cookie } })).status).toBe(200);
  });

  it('no elimina las cuentas predeterminadas', async () => {
    process.env.SEED_ADMIN_PASSWORD ??= 'seed-admin-password-12';
    process.env.SEED_STAFF_PASSWORD ??= 'seed-staff-password-12';
    await ensureDefaultUsers(getAuth(), { force: true });

    const list = await app.request('/api/admin/users', { headers: { cookie: admin.cookie } });
    const body = (await list.json()) as { users: { id: string; email: string }[] };
    const seed = body.users.find((user) => user.email === ADMIN_EMAIL);
    expect(seed).toBeTruthy();
    const response = await app.request(`/api/admin/users/${seed?.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(response.status).toBe(400);
  });
});

describe('cuentas predeterminadas', () => {
  it('no cambia la contraseña y corrige el rol si se desvió', async () => {
    process.env.SEED_ADMIN_PASSWORD ??= 'seed-admin-password-12';
    process.env.SEED_STAFF_PASSWORD ??= 'seed-staff-password-12';
    const [before] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, STAFF_EMAIL));

    await ensureDefaultUsers(getAuth(), { force: true });
    const [account] = await getDb()
      .select({ password: accounts.password })
      .from(accounts)
      .innerJoin(users, eq(accounts.userId, users.id))
      .where(eq(users.email, STAFF_EMAIL));
    const hash = account?.password;
    expect(hash).toBeTruthy();

    await getDb().update(users).set({ role: 'admin' }).where(eq(users.email, STAFF_EMAIL));
    await getDb().update(profiles).set({ role: 'admin' }).where(eq(profiles.email, STAFF_EMAIL));
    await ensureDefaultUsers(getAuth(), { force: true });

    const [user] = await getDb().select({ role: users.role }).from(users).where(eq(users.email, STAFF_EMAIL));
    const [profile] = await getDb().select({ role: profiles.role }).from(profiles).where(eq(profiles.email, STAFF_EMAIL));
    const [again] = await getDb()
      .select({ password: accounts.password })
      .from(accounts)
      .innerJoin(users, eq(accounts.userId, users.id))
      .where(eq(users.email, STAFF_EMAIL));
    expect(user?.role).toBe('staff');
    expect(profile?.role).toBe('staff');
    expect(again?.password).toBe(hash);

    if (!before) await getDb().delete(users).where(eq(users.email, STAFF_EMAIL));
  });
});
