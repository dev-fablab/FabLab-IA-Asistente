import { and, eq, gt, gte, lt, lte } from 'drizzle-orm';
import { getDb, type Database } from '../client';
import { availabilityExceptions, availabilityRules, meetings } from '../schema';
import {
  addDaysToDate,
  CALENDAR_TIME_ZONE,
  computeDayAvailability,
  dateInTimeZone,
  instantAt,
  MAX_DAYS_AHEAD,
  MEETING_DURATION_MINUTES,
  openWindowsFor,
  type DayAvailability,
  type MinuteWindow,
} from './slots';

/** La base de datos o una transacción: ambas ofrecen las mismas consultas. */
export type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export type AvailabilityOptions = {
  /** Primer día (`YYYY-MM-DD`); por defecto hoy. Nunca antes de hoy. */
  from?: string | undefined;
  /** Cantidad de días, de 1 a `MAX_DAYS_AHEAD`; por defecto 7. */
  days?: number | undefined;
  now?: Date;
};

export type Availability = {
  timeZone: string;
  durationMinutes: number;
  days: DayAvailability[];
};

/** Horarios libres, ocupados y ventanas de atención de los próximos días. */
export async function getAvailability(
  { from, days = 7, now = new Date() }: AvailabilityOptions = {},
  db: Executor = getDb(),
): Promise<Availability> {
  const today = dateInTimeZone(now);
  const first = from && from > today ? from : today;
  const count = Math.min(Math.max(Math.trunc(days), 1), MAX_DAYS_AHEAD);
  const dates = Array.from({ length: count }, (_, index) => addDaysToDate(first, index));
  const last = dates[dates.length - 1]!;

  const [rules, exceptions, booked] = await Promise.all([
    db
      .select({
        weekday: availabilityRules.weekday,
        startMinute: availabilityRules.startMinute,
        endMinute: availabilityRules.endMinute,
      })
      .from(availabilityRules)
      .where(eq(availabilityRules.isActive, true)),
    db
      .select({
        date: availabilityExceptions.date,
        kind: availabilityExceptions.kind,
        startMinute: availabilityExceptions.startMinute,
        endMinute: availabilityExceptions.endMinute,
      })
      .from(availabilityExceptions)
      .where(and(gte(availabilityExceptions.date, first), lte(availabilityExceptions.date, last))),
    db
      .select({ start: meetings.startsAt, end: meetings.endsAt })
      .from(meetings)
      .where(
        and(
          eq(meetings.status, 'scheduled'),
          lt(meetings.startsAt, instantAt(last, 1440)),
          gt(meetings.endsAt, instantAt(first, 0)),
        ),
      ),
  ]);

  return {
    timeZone: CALENDAR_TIME_ZONE,
    durationMinutes: MEETING_DURATION_MINUTES,
    days: dates.map((date) => computeDayAvailability({ date, rules, exceptions, meetings: booked, now })),
  };
}

/** Las ventanas de atención de una fecha (horario base más excepciones), sin descontar reuniones. */
export async function getOpenWindows(date: string, db: Executor = getDb()): Promise<MinuteWindow[]> {
  const [rules, exceptions] = await Promise.all([
    db
      .select({
        weekday: availabilityRules.weekday,
        startMinute: availabilityRules.startMinute,
        endMinute: availabilityRules.endMinute,
      })
      .from(availabilityRules)
      .where(eq(availabilityRules.isActive, true)),
    db
      .select({
        date: availabilityExceptions.date,
        kind: availabilityExceptions.kind,
        startMinute: availabilityExceptions.startMinute,
        endMinute: availabilityExceptions.endMinute,
      })
      .from(availabilityExceptions)
      .where(eq(availabilityExceptions.date, date)),
  ]);
  return openWindowsFor(date, rules, exceptions);
}
