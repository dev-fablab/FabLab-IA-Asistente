import type { ProfileRole } from '@fablab/db';
import { createMiddleware } from 'hono/factory';
import { forbidden, unauthorized } from '../errors';
import type { AppEnv, AuthDeps } from '../types';

/**
 * Protege `/admin/*`: exige una sesión de Better Auth y una fila en `profiles`.
 * 401 sin sesión, 403 sin perfil. La conexión de Drizzle omite RLS, así que esta
 * es la barrera real de acceso a los datos; la protección de la web solo mejora la experiencia.
 */
export function requireStaff(deps: AuthDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = await deps.getUserId(c.req.raw.headers);
    if (!userId) throw unauthorized('La sesión no es válida o expiró');

    const staff = await deps.findProfile(userId);
    if (!staff) throw forbidden('Tu cuenta no tiene acceso al panel');

    c.set('staff', staff);
    await next();
  });
}

/** Exige un rol concreto; se monta después de `requireStaff`. */
export function requireRole(role: ProfileRole) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.get('staff').role !== role) throw forbidden('Esta acción requiere otro rol');
    await next();
  });
}
