import { createTool } from '@mastra/core/tools';
import { bookMeeting, contactExists, dateInTimeZone, getAvailability, instantAt, isDateString } from '@fablab/db';
import { z } from 'zod';
import { logToolFailure } from '../log';
import { slotSchema, toSlot } from './calendar-format';

export const SCHEDULE_MEETING_TOOL_ID = 'scheduleMeeting';

const FIELDS = ['name', 'email', 'reason', 'startsAt'] as const;
const MAX_ALTERNATIVES = 5;

export const scheduleMeetingOutputSchema = z.object({
  status: z.enum(['needs_info', 'booked', 'slot_unavailable', 'limit_reached', 'unavailable']),
  /** Datos que faltan: pídeselos a la persona antes de volver a llamar a la herramienta. */
  missing: z.array(z.enum(FIELDS)).optional(),
  /** Datos entregados pero inválidos. */
  invalid: z.array(z.enum(['email', 'startsAt'])).optional(),
  /** Si el correo ya es un contacto de Fab Lab. Un contacto existente no necesita dar su nombre otra vez. */
  contact: z.enum(['existing', 'new']).optional(),
  meeting: z.object({ start: z.string(), end: z.string(), label: z.string(), reason: z.string() }).optional(),
  /** Horarios libres cercanos cuando el pedido ya no está disponible. */
  alternatives: z.array(slotSchema).optional(),
  limit: z.enum(['contact', 'conversation']).optional(),
  /** Falló por un problema técnico: no se agendó nada. */
  unavailable: z.boolean().optional(),
});

export type ScheduleMeetingResult = z.infer<typeof scheduleMeetingOutputSchema>;

const emailSchema = z.email().max(254);

const NAIVE_LOCAL = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Instante pedido por el modelo. En un turno de confirmación el modelo ya no tiene la lista de horarios (el hilo
 * no conserva las herramientas) y puede escribir la hora a mano: sin zona se entiende como hora de Fab Lab y no
 * como la del servidor, que reservaría horas corridas sin avisar. Cualquier otro formato es inválido.
 */
export function parseStartsAt(value: string): Date {
  const local = NAIVE_LOCAL.exec(value);
  if (local) {
    const [, date, hours, minutes] = local;
    if (!isDateString(date!) || Number(hours) > 23 || Number(minutes) > 59) return new Date(Number.NaN);
    return instantAt(date!, Number(hours) * 60 + Number(minutes));
  }
  return WITH_ZONE.test(value) ? new Date(value) : new Date(Number.NaN);
}

/** Horarios libres desde el día pedido, para ofrecer una salida cuando el bloque se ocupó. */
async function nearbySlots(startsAt: Date | undefined) {
  const from = startsAt && !Number.isNaN(startsAt.getTime()) ? dateInTimeZone(startsAt) : undefined;
  const { days } = await getAvailability({ from, days: 7 });
  return days.flatMap((day) => day.free).slice(0, MAX_ALTERNATIVES).map(toSlot);
}

/**
 * Agenda una reunión presencial. La herramienta no lanza por datos incompletos: responde `needs_info`
 * con lo que falta, y distingue si el correo ya es un contacto. Las reglas del horario y los topes se
 * aplican aquí, no en las instrucciones: el modelo no puede saltárselos.
 */
export const scheduleMeeting = createTool({
  id: SCHEDULE_MEETING_TOOL_ID,
  description:
    'Agenda una reunión presencial en Fab Lab. Llámala solo cuando la persona ya eligió un horario de getAvailableSlots ' +
    'y confirmó que quiere agendar. Necesita nombre, correo, motivo y horario (`startsAt`, el `start` del bloque elegido). ' +
    'Si el correo ya es un contacto no hace falta el nombre. Si falta algo, responde `needs_info` con lo que falta: ' +
    'pídeselo a la persona y vuelve a llamarla con todos los datos. Incluye un resumen de la conversación y los puntos clave.',
  inputSchema: z.object({
    name: z.string().trim().max(120).optional().describe('Nombre de la persona; obligatorio solo si es un contacto nuevo'),
    email: z.string().trim().max(254).optional().describe('Correo de la persona'),
    reason: z.string().trim().max(500).optional().describe('Motivo de la reunión, con las palabras de la persona'),
    startsAt: z.string().trim().max(40).optional().describe('Inicio del bloque elegido: el campo `start` de getAvailableSlots (ISO 8601). Si no trae zona se entiende como hora de Fab Lab'),
    conversationSummary: z
      .string()
      .trim()
      .max(1500)
      .optional()
      .describe('Resumen breve de la conversación que originó la reserva, para el equipo de Fab Lab'),
    keyPoints: z
      .array(z.string().trim().min(1).max(300))
      .max(10)
      .optional()
      .describe('Puntos importantes para el acta, p. ej. «Necesita X», «La idea más pulida es Y»'),
  }),
  outputSchema: scheduleMeetingOutputSchema,
  execute: async (input, { requestContext }): Promise<ScheduleMeetingResult> => {
    try {
      const conversationId = z.uuid().safeParse(requestContext?.get('conversationId')).data;

      const email = input.email ? emailSchema.safeParse(input.email) : undefined;
      const startsAt = input.startsAt ? parseStartsAt(input.startsAt) : undefined;
      const invalid: Array<'email' | 'startsAt'> = [];
      if (email && !email.success) invalid.push('email');
      if (startsAt && Number.isNaN(startsAt.getTime())) invalid.push('startsAt');

      // Solo se consulta el contacto con un correo válido; antes no se sabe si hará falta el nombre.
      const knownEmail = email?.success ? email.data : undefined;
      const exists = knownEmail ? await contactExists(knownEmail) : undefined;
      const contact = exists === undefined ? undefined : exists ? ('existing' as const) : ('new' as const);

      const missing = FIELDS.filter((field) => {
        if (field === 'name') return exists === false && !input.name;
        if (field === 'email') return !knownEmail;
        if (field === 'reason') return !input.reason;
        return !startsAt || invalid.includes('startsAt');
      });
      if (missing.length > 0) {
        return {
          status: 'needs_info',
          missing,
          ...(invalid.length > 0 && { invalid }),
          ...(contact && { contact }),
        };
      }

      const result = await bookMeeting({
        email: knownEmail!,
        name: input.name,
        reason: input.reason!,
        startsAt: startsAt!,
        conversationId,
        conversationSummary: input.conversationSummary,
        keyPoints: input.keyPoints,
      });

      switch (result.status) {
        case 'booked': {
          const slot = toSlot({ start: result.meeting.startsAt, end: result.meeting.endsAt });
          return {
            status: 'booked',
            contact: result.contactIsNew ? 'new' : 'existing',
            meeting: { ...slot, reason: input.reason! },
          };
        }
        case 'name_required':
          return { status: 'needs_info', missing: ['name'], contact: 'new' };
        case 'limit_reached':
          return { status: 'limit_reached', limit: result.limit };
        case 'slot_unavailable':
          return { status: 'slot_unavailable', alternatives: await nearbySlots(startsAt) };
      }
    } catch (error) {
      logToolFailure(SCHEDULE_MEETING_TOOL_ID, error);
      return { status: 'unavailable', unavailable: true };
    }
  },
});
