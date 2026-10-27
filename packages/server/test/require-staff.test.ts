import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { handleError } from '../src/middleware/error';
import { requireRole, requireStaff } from '../src/middleware/require-staff';
import type { AppEnv, AuthDeps } from '../src/types';

const UUID = '00000000-0000-4000-8000-000000000000';

// El doble lee el encabezado como lo hacía el JWT: las pruebas no necesitan una cookie real.
const bearer = (headers: Headers) => headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];

const deps: AuthDeps = {
  getUserId: async (headers) => {
    const token = bearer(headers);
    if (token === 'staff-token') return 'staff-id';
    if (token === 'admin-token') return 'admin-id';
    if (token === 'no-profile-token') return 'ghost-id';
    return null;
  },
  findProfile: async (id) => {
    if (id === 'staff-id') return { id, email: 'staff@fablab.cl', role: 'staff' };
    if (id === 'admin-id') return { id, email: 'admin@fablab.cl', role: 'admin' };
    return null;
  },
};

const app = createApp({ basePath: '/api', auth: deps });

/** Todas las rutas de administración registradas, con los parámetros reemplazados. */
function adminRoutes() {
  const seen = new Set<string>();
  const routes: { method: string; path: string }[] = [];
  for (const route of app.routes) {
    if (!route.path.startsWith('/api/admin') || route.method === 'ALL') continue;
    const path = route.path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, UUID);
    const key = `${route.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method: route.method, path });
  }
  return routes;
}

const request = (method: string, path: string, authorization?: string) =>
  app.request(path, { method, headers: authorization ? { authorization } : {} });

describe('GET /api/health', () => {
  it('es público', async () => {
    const res = await request('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('rutas /api/admin/*', () => {
  const routes = adminRoutes();

  it('hay rutas de administración registradas', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes)('$method $path responde 401 sin token', async ({ method, path }) => {
    const res = await request(method, path);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it.each(routes)('$method $path responde 401 con un token inválido', async ({ method, path }) => {
    expect((await request(method, path, 'Bearer garbage')).status).toBe(401);
    expect((await request(method, path, 'Basic abc')).status).toBe(401);
  });

  it.each(routes)('$method $path responde 403 con JWT válido pero sin perfil', async ({ method, path }) => {
    const res = await request(method, path, 'Bearer no-profile-token');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('una ruta de administración inexistente también exige sesión (no revela qué existe)', async () => {
    expect((await request('GET', '/api/admin/no-existe')).status).toBe(401);
    expect((await request('GET', '/api/admin/no-existe', 'Bearer no-profile-token')).status).toBe(403);
  });

  it('GET /api/admin/me devuelve el perfil con sesión y perfil válidos', async () => {
    const res = await request('GET', '/api/admin/me', 'Bearer staff-token');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'staff-id', email: 'staff@fablab.cl', role: 'staff' });
  });
});

describe('formato de errores', () => {
  it('una ruta inexistente responde 404 con el formato de la API', async () => {
    const res = await request('GET', '/api/no-existe');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Recurso no encontrado' } });
  });

  it('un error inesperado responde 500 sin filtrar el detalle', async () => {
    const boom = new Hono().onError(handleError).get('/boom', () => {
      throw new Error('contraseña de la base: hunter2');
    });
    const res = await boom.request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'internal_error', message: 'Error interno' } });
  });

  it('agrega los encabezados de seguridad', async () => {
    const res = await request('GET', '/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('requireRole', () => {
  const guarded = new Hono<AppEnv>()
    .onError(handleError)
    .use('*', requireStaff(deps))
    .get('/solo-admin', requireRole('admin'), (c) => c.json({ ok: true }));

  it('deja pasar a un admin', async () => {
    const res = await guarded.request('/solo-admin', { headers: { authorization: 'Bearer admin-token' } });
    expect(res.status).toBe(200);
  });

  it('rechaza con 403 a un staff', async () => {
    const res = await guarded.request('/solo-admin', { headers: { authorization: 'Bearer staff-token' } });
    expect(res.status).toBe(403);
  });
});
