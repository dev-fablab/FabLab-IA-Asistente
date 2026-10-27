import { PROFILE_ROLES } from '@fablab/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { DOMAIN_ERROR, isStaffDomainEmail } from '../auth/domain';
import { requireRole } from '../middleware/require-staff';
import { createAccessUser, deleteAccessUser, listAccessUsers, updateAccessUser } from '../services/access';
import type { AppEnv } from '../types';
import { validate } from '../validation';

const staffEmail = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isStaffDomainEmail, DOMAIN_ERROR);

const role = z.enum(PROFILE_ROLES);

const createBody = z.object({
  email: staffEmail,
  password: z.string().min(12, 'La contraseña debe tener al menos 12 caracteres'),
  role,
});

const updateBody = z
  .object({
    email: staffEmail,
    role,
    password: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.password && value.password.length > 0 && value.password.length < 12) {
      ctx.addIssue({ code: 'custom', message: 'La contraseña debe tener al menos 12 caracteres', path: ['password'] });
    }
  });

const idParam = z.object({ id: z.uuid() });

/** Altas, cambios y bajas de acceso. Solo el rol `admin`. */
export function createUserRoutes() {
  return new Hono<AppEnv>()
    .use('*', requireRole('admin'))
    .get('/', async (c) => c.json({ users: await listAccessUsers(c.req.raw.headers) }))
    .post('/', validate('json', createBody), async (c) => {
      const user = await createAccessUser(c.req.raw.headers, c.req.valid('json'));
      return c.json({ user }, 201);
    })
    .patch('/:id', validate('param', idParam), validate('json', updateBody), async (c) => {
      const user = await updateAccessUser(c.req.raw.headers, c.req.valid('param').id, c.req.valid('json'));
      return c.json({ user });
    })
    .delete('/:id', validate('param', idParam), async (c) => {
      await deleteAccessUser(c.req.raw.headers, c.req.valid('param').id, c.get('staff').id);
      return c.json({ ok: true });
    });
}
