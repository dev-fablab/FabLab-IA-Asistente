import { TZDate } from '@date-fns/tz';

/** Zona horaria de Fab Lab: todas las fechas y horas del calendario se interpretan en ella. */
export const CALENDAR_TIME_ZONE = 'America/Santiago';
export const MEETING_DURATION_MINUTES = 60;
/** Anticipación mínima para reservar: no se ofrecen horarios que empiezan antes de este plazo. */
export const MIN_NOTICE_MINUTES = 120;
/** Hasta cuántos días hacia adelante se puede reservar. */
export const MAX_DAYS_AHEAD = 60;

/** Ventana del día en minutos desde la medianoche. */
export type MinuteWindow = { startMinute: number; endMinute: number };
/** `weekday` sigue `Date#getDay`: 0 = domingo … 6 = sábado. */
export type WeeklyRule = MinuteWindow & { weekday: number };
export type DateException = {
  /** `YYYY-MM-DD`. */
  date: string;
  kind: 'closed' | 'open';
  startMinute: number | null;
  endMinute: number | null;
};
export type TimeRange = { start: Date; end: Date };

export type DayAvailability = {
  date: string;
  weekday: number;
  /** Ventanas en que Fab Lab atiende ese día (horario base más excepciones). */
  open: MinuteWindow[];
  /** Horarios que se pueden reservar. */
  free: TimeRange[];
  /** Reuniones ya agendadas que tocan el día; sin datos de la persona. */
  busy: TimeRange[];
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: string): [number, number, number] {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Fecha inválida: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `YYYY-MM-DD` que además existe en el calendario (rechaza 2026-02-30). */
export function isDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [y, m, d] = parts(value);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

/** Día de la semana de una fecha de calendario (no depende de la zona horaria). */
export function weekdayOf(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** La fecha de calendario de un instante en la zona de Fab Lab. */
export function dateInTimeZone(instant: Date, timeZone = CALENDAR_TIME_ZONE): string {
  const zoned = new TZDate(instant.getTime(), timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}`;
}

/** Minutos transcurridos desde la medianoche de un instante, en la zona de Fab Lab. */
export function minuteOfDayInTimeZone(instant: Date, timeZone = CALENDAR_TIME_ZONE): number {
  const zoned = new TZDate(instant.getTime(), timeZone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

/** El instante en que son `minute` minutos desde la medianoche de `date` en la zona dada. */
export function instantAt(date: string, minute: number, timeZone = CALENDAR_TIME_ZONE): Date {
  const [y, m, d] = parts(date);
  return new Date(new TZDate(y, m - 1, d, Math.floor(minute / 60), minute % 60, timeZone).getTime());
}

/** Ordena y une las ventanas que se solapan o se tocan. */
export function mergeWindows(windows: MinuteWindow[]): MinuteWindow[] {
  const sorted = windows
    .map(({ startMinute, endMinute }) => ({ startMinute, endMinute }))
    .sort((a, b) => a.startMinute - b.startMinute);
  const merged: MinuteWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.startMinute <= last.endMinute) last.endMinute = Math.max(last.endMinute, window.endMinute);
    else merged.push(window);
  }
  return merged;
}

function subtractWindow(windows: MinuteWindow[], cut: MinuteWindow): MinuteWindow[] {
  return windows.flatMap((window) => {
    if (cut.endMinute <= window.startMinute || cut.startMinute >= window.endMinute) return [window];
    const left = { startMinute: window.startMinute, endMinute: cut.startMinute };
    const right = { startMinute: cut.endMinute, endMinute: window.endMinute };
    return [left, right].filter((part) => part.startMinute < part.endMinute);
  });
}

/**
 * Ventanas de atención de un día: el horario semanal más las excepciones de esa fecha. Primero se
 * aplican las aperturas y después los cierres, así que un cierre siempre gana sobre una apertura.
 */
export function openWindowsFor(date: string, rules: WeeklyRule[], exceptions: DateException[]): MinuteWindow[] {
  const weekday = weekdayOf(date);
  let windows = mergeWindows(rules.filter((rule) => rule.weekday === weekday));
  const today = exceptions.filter((exception) => exception.date === date);

  for (const exception of today) {
    if (exception.kind === 'open' && exception.startMinute !== null && exception.endMinute !== null) {
      windows = mergeWindows([...windows, { startMinute: exception.startMinute, endMinute: exception.endMinute }]);
    }
  }
  for (const exception of today) {
    if (exception.kind !== 'closed') continue;
    windows =
      exception.startMinute === null || exception.endMinute === null
        ? []
        : subtractWindow(windows, { startMinute: exception.startMinute, endMinute: exception.endMinute });
  }
  return windows;
}

const overlaps = (a: TimeRange, b: TimeRange) => a.start < b.end && b.start < a.end;

export type DayInput = {
  date: string;
  rules: WeeklyRule[];
  exceptions: DateException[];
  /** Reuniones `scheduled` que pueden tocar este día. */
  meetings: TimeRange[];
  now: Date;
  durationMinutes?: number;
  minNoticeMinutes?: number;
  timeZone?: string;
};

/** Disponibilidad de un día. Es la única fuente de verdad: lo que se ofrece es lo que se puede reservar. */
export function computeDayAvailability({
  date,
  rules,
  exceptions,
  meetings,
  now,
  durationMinutes = MEETING_DURATION_MINUTES,
  minNoticeMinutes = MIN_NOTICE_MINUTES,
  timeZone = CALENDAR_TIME_ZONE,
}: DayInput): DayAvailability {
  const open = openWindowsFor(date, rules, exceptions);
  const earliest = new Date(now.getTime() + minNoticeMinutes * 60_000);
  const day: TimeRange = { start: instantAt(date, 0, timeZone), end: instantAt(date, 1440, timeZone) };
  const busy = meetings
    .filter((meeting) => overlaps(meeting, day))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const free: TimeRange[] = [];
  for (const window of open) {
    // La rejilla parte del inicio de cada ventana, en pasos de la duración de la reunión.
    for (let start = window.startMinute; start + durationMinutes <= window.endMinute; start += durationMinutes) {
      const slot = { start: instantAt(date, start, timeZone), end: instantAt(date, start + durationMinutes, timeZone) };
      if (slot.start < earliest) continue;
      if (busy.some((meeting) => overlaps(meeting, slot))) continue;
      free.push(slot);
    }
  }
  return { date, weekday: weekdayOf(date), open, free, busy };
}
