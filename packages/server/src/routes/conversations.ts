import { Hono } from 'hono';
import { z } from 'zod';
import { getConversationDetail, listConversations } from '../services/conversations';
import type { AppEnv } from '../types';
import { validate } from '../validation';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD');

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    noAnswer: z.enum(['true', 'false']).optional(),
    from: day.optional(),
    to: day.optional(),
    q: z.string().trim().max(200).optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'La fecha inicial no puede ser posterior a la final',
  });

/** Historial de conversaciones del panel: solo lectura en la Fase 1 (no hay borrado). */
export function createConversationRoutes() {
  return new Hono<AppEnv>()
    .get('/', validate('query', listQuery), async (c) => {
      const { noAnswer, q, ...query } = c.req.valid('query');
      return c.json(
        await listConversations({
          ...query,
          noAnswer: noAnswer === 'true',
          q: q || undefined,
        }),
      );
    })
    .get('/:id', validate('param', z.object({ id: z.uuid() })), async (c) =>
      c.json(await getConversationDetail(c.req.valid('param').id)),
    );
}
