import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodType } from 'zod';
import { errorBody } from './errors';
import { logger } from './logger';

/**
 * `zValidator` con el formato de error de la API: 400 y `{ error: { code, message } }`
 * en lugar del cuerpo por defecto del validador.
 */
export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const first = result.error.issues[0];
      const where = first?.path.length ? ` (${first.path.join('.')})` : '';
      // Qué campo falló y por qué, nunca el valor recibido (puede ser el mensaje de la persona).
      logger.warn('request.invalid', {
        target,
        issues: result.error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })),
      });
      return c.json(errorBody('bad_request', `${first?.message ?? 'Solicitud no válida'}${where}`), 400);
    }
  });
}
