import { CONTACT_CHANNEL_TYPES } from '@fablab/db';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createContactChannel,
  deleteContactChannel,
  listContactChannels,
  updateContactChannel,
} from '../services/contact-channels';
import type { AppEnv } from '../types';
import { validate } from '../validation';

const idParam = z.object({ id: z.uuid() });

const fields = {
  type: z.enum(CONTACT_CHANNEL_TYPES),
  label: z.string().trim().min(1, 'Indica una etiqueta').max(100),
  value: z.string().trim().min(1, 'Indica el valor del canal').max(500),
  // Un texto vacío equivale a «sin notas».
  notes: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((notes) => notes || null),
  sortOrder: z.number().int().min(0).max(9999),
  isActive: z.boolean(),
};

// Sin valores por defecto en el esquema: en un PATCH un campo ausente no debe pisar el existente.
const createBody = z.object({
  type: fields.type,
  label: fields.label,
  value: fields.value,
  notes: fields.notes.optional(),
  sortOrder: fields.sortOrder.optional(),
  isActive: fields.isActive.optional(),
});

const patchBody = z
  .object({
    type: fields.type.optional(),
    label: fields.label.optional(),
    value: fields.value.optional(),
    notes: fields.notes.optional(),
    sortOrder: fields.sortOrder.optional(),
    isActive: fields.isActive.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Indica al menos un campo para editar',
  });

/** Administración de los canales oficiales de contacto (RF-18). Solo los activos los ve el agente. */
export function createContactChannelRoutes() {
  return new Hono<AppEnv>()
    .get('/', async (c) => c.json({ channels: await listContactChannels() }))
    .post('/', validate('json', createBody), async (c) => c.json({ channel: await createContactChannel(c.req.valid('json')) }, 201))
    .patch('/:id', validate('param', idParam), validate('json', patchBody), async (c) =>
      c.json({ channel: await updateContactChannel(c.req.valid('param').id, c.req.valid('json')) }),
    )
    .delete('/:id', validate('param', idParam), async (c) => {
      await deleteContactChannel(c.req.valid('param').id);
      return c.body(null, 204);
    });
}
