import { CALENDAR_TIME_ZONE, type TimeRange } from '@fablab/db';
import { z } from 'zod';

/** Horario ofrecido o agendado, listo para el modelo (`start` se pasa tal cual a `scheduleMeeting`). */
export const slotSchema = z.object({
  start: z.string().describe('Inicio en ISO 8601; es el valor para `startsAt` de scheduleMeeting'),
  end: z.string(),
  label: z.string().describe('Texto para decirle a la persona, en la hora de Fab Lab'),
});

export type Slot = z.infer<typeof slotSchema>;

const dateFormat = new Intl.DateTimeFormat('es-CL', {
  timeZone: CALENDAR_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const timeFormat = new Intl.DateTimeFormat('es-CL', {
  timeZone: CALENDAR_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const weekdayName = (instant: Date) =>
  new Intl.DateTimeFormat('es-CL', { timeZone: CALENDAR_TIME_ZONE, weekday: 'long' }).format(instant);

/** «lunes 26 de octubre, de 08:00 a 09:00». */
export function slotLabel({ start, end }: TimeRange): string {
  return `${dateFormat.format(start)}, de ${timeFormat.format(start)} a ${timeFormat.format(end)}`;
}

export function toSlot(range: TimeRange): Slot {
  return { start: range.start.toISOString(), end: range.end.toISOString(), label: slotLabel(range) };
}

/** «08:00» para un valor en minutos desde la medianoche. */
export const minuteLabel = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
