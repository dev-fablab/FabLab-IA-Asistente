import { AVAILABILITY_EXCEPTION_KINDS, CONTACT_CHANNEL_TYPES, CONTACT_SOURCES, isDateString, MEETING_STATUSES } from '@fablab/db';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createException,
  deleteException,
  getAvailabilityConfig,
  getOpenHours,
  replaceRules,
} from '../services/availability';
import { createPerson, getPersonDetail, listPeople, MAX_CONTACT_METHODS, updatePerson } from '../services/people';
import {
  addMinute,
  deleteMinute,
  getMeetingDetail,
  listMeetings,
  MAX_RANGE_DAYS,
  updateMeeting,
  updateMinute,
} from '../services/meetings';
import type { AppEnv } from '../types';
import { validate } from '../validation';

const idParam = z.object({ id: z.uuid() });
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const rangeQuery = z
  .object({ from: instant, to: instant })
  .refine((query) => query.from < query.to, { message: 'El inicio debe ser anterior al término' })
  .refine((query) => query.to.getTime() - query.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, {
    message: `El rango no puede superar ${MAX_RANGE_DAYS} días`,
  });

const dayString = z.string().refine(isDateString, 'La fecha debe tener el formato AAAA-MM-DD');

const minuteOfDay = z.number().int().min(0).max(1440);

const rulesBody = z.object({
  rules: z
    .array(
      z
        .object({ weekday: z.number().int().min(0).max(6), startMinute: minuteOfDay, endMinute: minuteOfDay })
        .refine((rule) => rule.startMinute < rule.endMinute, { message: 'La hora de inicio debe ser anterior a la de término' }),
    )
    .max(70),
});

const exceptionBody = z
  .object({
    date: dayString,
    kind: z.enum(AVAILABILITY_EXCEPTION_KINDS),
    startMinute: minuteOfDay.nullish(),
    endMinute: minuteOfDay.nullish(),
    note: z.string().trim().max(200).nullish(),
  })
  .refine((body) => body.startMinute == null || body.endMinute == null || body.startMinute < body.endMinute, {
    message: 'La hora de inicio debe ser anterior a la de término',
  });

const openHoursQuery = z
  .object({ from: dayString, to: dayString })
  .refine((query) => query.from <= query.to, { message: 'El inicio no puede ser posterior al término' })
  .refine((query) => (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 <= MAX_RANGE_DAYS, {
    message: `El rango no puede superar ${MAX_RANGE_DAYS} días`,
  });

/** Estado, nuevo horario (reagendar) y/o responsable; `responsibleId: null` deja la reunión sin responsable. */
const meetingPatchBody = z
  .object({
    status: z.enum(MEETING_STATUSES).optional(),
    startsAt: instant.optional(),
    responsibleId: z.uuid().nullable().optional(),
  })
  .refine((body) => body.status !== undefined || body.startsAt !== undefined || body.responsibleId !== undefined, {
    message: 'Indica al menos un campo para editar',
  });

const peopleQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  q: z.string().trim().max(200).optional(),
  source: z.enum(CONTACT_SOURCES).optional(),
});

const methodBody = z.object({ type: z.enum(CONTACT_CHANNEL_TYPES), value: z.string().trim().min(1, 'Indica el medio de contacto').max(500) });

// El nombre y el correo son siempre obligatorios; los demás medios de contacto son opcionales.
const personFields = {
  name: z.string().trim().min(1, 'Indica el nombre').max(120),
  email: z.string().trim().min(1, 'Indica el correo').max(254),
  source: z.enum(CONTACT_SOURCES),
  methods: z.array(methodBody).max(MAX_CONTACT_METHODS),
};
const createPersonBody = z.object({ ...personFields, methods: personFields.methods.optional() });
// Sin valores por defecto: en un PATCH un campo ausente no debe pisar el existente.
const patchPersonBody = z
  .object({ name: personFields.name.optional(), email: personFields.email.optional(), source: personFields.source.optional(), methods: personFields.methods.optional() })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'Indica al menos un campo para editar' });

const minuteBody = z.object({ content: z.string().trim().min(1, 'Escribe el punto del acta').max(500) });

/**
 * Calendario y reuniones del panel (`/admin/calendar`). Las reuniones las crea el agente desde el chat;
 * aquí el equipo las consulta, las cierra o cancela, edita el acta y define la disponibilidad.
 */
export function createCalendarRoutes() {
  return new Hono<AppEnv>()
    .get('/meetings', validate('query', rangeQuery), async (c) => c.json(await listMeetings(c.req.valid('query'))))
    .get('/meetings/:id', validate('param', idParam), async (c) => c.json(await getMeetingDetail(c.req.valid('param').id)))
    .patch('/meetings/:id', validate('param', idParam), validate('json', meetingPatchBody), async (c) =>
      c.json(await updateMeeting(c.req.valid('param').id, c.req.valid('json'))),
    )
    .post('/meetings/:id/minutes', validate('param', idParam), validate('json', minuteBody), async (c) =>
      c.json({ minute: await addMinute(c.req.valid('param').id, c.req.valid('json').content) }, 201),
    )
    .patch('/minutes/:id', validate('param', idParam), validate('json', minuteBody), async (c) =>
      c.json({ minute: await updateMinute(c.req.valid('param').id, c.req.valid('json').content) }),
    )
    .delete('/minutes/:id', validate('param', idParam), async (c) => {
      await deleteMinute(c.req.valid('param').id);
      return c.body(null, 204);
    })

    .get('/people', validate('query', peopleQuery), async (c) => {
      const { page, q, source } = c.req.valid('query');
      return c.json(await listPeople({ page, q: q || undefined, source }));
    })
    .post('/people', validate('json', createPersonBody), async (c) => c.json(await createPerson(c.req.valid('json'), c.get('staff').id), 201))
    .get('/people/:id', validate('param', idParam), async (c) => c.json(await getPersonDetail(c.req.valid('param').id)))
    .patch('/people/:id', validate('param', idParam), validate('json', patchPersonBody), async (c) =>
      c.json(await updatePerson(c.req.valid('param').id, c.req.valid('json'))),
    )

    .get('/availability', async (c) => c.json(await getAvailabilityConfig()))
    .get('/availability/open-hours', validate('query', openHoursQuery), async (c) => {
      const { from, to } = c.req.valid('query');
      return c.json(await getOpenHours(from, to));
    })
    .put('/availability/rules', validate('json', rulesBody), async (c) => c.json(await replaceRules(c.req.valid('json').rules)))
    .post('/availability/exceptions', validate('json', exceptionBody), async (c) =>
      c.json({ exception: await createException(c.req.valid('json')) }, 201),
    )
    .delete('/availability/exceptions/:id', validate('param', idParam), async (c) => {
      await deleteException(c.req.valid('param').id);
      return c.body(null, 204);
    });
}
