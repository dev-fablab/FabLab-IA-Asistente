import { createTool } from '@mastra/core/tools';
import { getAvailability, instantAt, isDateString, MAX_DAYS_AHEAD } from '@fablab/db';
import { z } from 'zod';
import { logToolFailure } from '../log';
import { minuteLabel, slotSchema, toSlot, weekdayName } from './calendar-format';

export const GET_AVAILABLE_SLOTS_TOOL_ID = 'getAvailableSlots';

const MAX_DAYS = 14;

export const getAvailableSlotsOutputSchema = z.object({
  timeZone: z.string(),
  durationMinutes: z.number(),
  days: z.array(
    z.object({
      date: z.string().describe('YYYY-MM-DD'),
      weekday: z.string(),
      open: z.array(z.object({ start: z.string(), end: z.string() })).describe('Horas de atención; vacío si ese día no se atiende'),
      free: z.array(slotSchema).describe('Horarios que se pueden reservar'),
      busy: z.array(z.object({ start: z.string(), end: z.string() })).describe('Reuniones ya agendadas (sin datos de la persona)'),
    }),
  ),
  /** No se pudo consultar el calendario por un problema técnico: no significa que no haya horarios. */
  unavailable: z.boolean().optional(),
});

export type GetAvailableSlotsResult = z.infer<typeof getAvailableSlotsOutputSchema>;

/** Disponibilidad de reuniones presenciales en Fab Lab para los próximos días. */
export const getAvailableSlots = createTool({
  id: GET_AVAILABLE_SLOTS_TOOL_ID,
  description:
    'Consulta los horarios disponibles para una reunión presencial en Fab Lab: por día, las horas de atención, ' +
    'los bloques libres que se pueden reservar y los ya ocupados. Sin parámetros devuelve los próximos 7 días. ' +
    'Úsala siempre antes de ofrecer un horario; no inventes horarios.',
  inputSchema: z.object({
    from: z
      .string()
      .refine(isDateString, 'Usa el formato YYYY-MM-DD')
      .optional()
      .describe('Primer día a consultar (YYYY-MM-DD). Por defecto, hoy'),
    days: z
      .number()
      .int()
      .min(1)
      .max(MAX_DAYS)
      .optional()
      .describe(`Cuántos días consultar, hasta ${MAX_DAYS}. Por defecto, 7. Solo se agenda hasta ${MAX_DAYS_AHEAD} días adelante`),
  }),
  outputSchema: getAvailableSlotsOutputSchema,
  execute: async ({ from, days }) => {
    try {
      const availability = await getAvailability({ from, days });
      return {
        timeZone: availability.timeZone,
        durationMinutes: availability.durationMinutes,
        days: availability.days.map((day) => ({
          date: day.date,
          weekday: weekdayName(instantAt(day.date, 720)),
          open: day.open.map((window) => ({ start: minuteLabel(window.startMinute), end: minuteLabel(window.endMinute) })),
          free: day.free.map(toSlot),
          busy: day.busy.map((range) => ({ start: range.start.toISOString(), end: range.end.toISOString() })),
        })),
      };
    } catch (error) {
      logToolFailure(GET_AVAILABLE_SLOTS_TOOL_ID, error);
      return { timeZone: '', durationMinutes: 0, days: [], unavailable: true };
    }
  },
});
