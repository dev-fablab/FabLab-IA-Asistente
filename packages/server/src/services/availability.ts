import {
  availabilityExceptions,
  availabilityRules,
  addDaysToDate,
  CALENDAR_TIME_ZONE,
  dateInTimeZone,
  getDb,
  MEETING_DURATION_MINUTES,
  openWindowsFor,
  type AvailabilityExceptionKind,
} from '@fablab/db';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { badRequest, notFound } from '../errors';

export type RuleInput = { weekday: number; startMinute: number; endMinute: number };

export type ExceptionInput = {
  date: string;
  kind: AvailabilityExceptionKind;
  startMinute?: number | null | undefined;
  endMinute?: number | null | undefined;
  note?: string | null | undefined;
};

/** Horario base y excepciones próximas, tal como las edita el equipo. */
export async function getAvailabilityConfig() {
  const db = getDb();
  const [rules, exceptions] = await Promise.all([
    db
      .select({ id: availabilityRules.id, weekday: availabilityRules.weekday, startMinute: availabilityRules.startMinute, endMinute: availabilityRules.endMinute })
      .from(availabilityRules)
      .where(eq(availabilityRules.isActive, true))
      .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startMinute)),
    // Las excepciones pasadas ya no cambian nada: solo se listan las de hoy en adelante.
    db
      .select()
      .from(availabilityExceptions)
      .where(gte(availabilityExceptions.date, dateInTimeZone(new Date())))
      .orderBy(asc(availabilityExceptions.date), asc(availabilityExceptions.startMinute)),
  ]);
  return { timeZone: CALENDAR_TIME_ZONE, durationMinutes: MEETING_DURATION_MINUTES, rules, exceptions };
}

/** Las ventanas de un mismo día no pueden solaparse: sería ambiguo qué horario manda. */
export function assertNoOverlappingRules(rules: RuleInput[]): void {
  const byDay = new Map<number, RuleInput[]>();
  for (const rule of rules) byDay.set(rule.weekday, [...(byDay.get(rule.weekday) ?? []), rule]);
  for (const windows of byDay.values()) {
    const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute);
    for (let index = 1; index < sorted.length; index++) {
      if (sorted[index]!.startMinute < sorted[index - 1]!.endMinute) {
        throw badRequest('Las ventanas de un mismo día no pueden solaparse');
      }
    }
  }
}

/** Reemplaza todo el horario semanal en una transacción: el panel envía el horario completo. */
export async function replaceRules(rules: RuleInput[]) {
  assertNoOverlappingRules(rules);
  await getDb().transaction(async (tx) => {
    await tx.delete(availabilityRules);
    if (rules.length > 0) await tx.insert(availabilityRules).values(rules);
  });
  return getAvailabilityConfig();
}

export async function createException(input: ExceptionInput) {
  const hasWindow = input.startMinute != null && input.endMinute != null;
  if (input.kind === 'open' && !hasWindow) throw badRequest('Una apertura necesita hora de inicio y de término');
  if ((input.startMinute == null) !== (input.endMinute == null)) throw badRequest('Indica la hora de inicio y la de término, o ninguna');

  const [exception] = await getDb()
    .insert(availabilityExceptions)
    .values({
      date: input.date,
      kind: input.kind,
      startMinute: input.startMinute ?? null,
      endMinute: input.endMinute ?? null,
      note: input.note || null,
    })
    .returning();
  return exception!;
}

export async function deleteException(id: string): Promise<void> {
  const deleted = await getDb().delete(availabilityExceptions).where(eq(availabilityExceptions.id, id)).returning({ id: availabilityExceptions.id });
  if (deleted.length === 0) throw notFound('Excepción no encontrada');
}

/**
 * Ventanas de atención de cada día del rango (horario base más excepciones). El calendario del panel las usa
 * para sombrear lo que no es horario de atención; las calcula la misma función que valida las reservas.
 */
export async function getOpenHours(from: string, to: string) {
  const db = getDb();
  const [rules, exceptions] = await Promise.all([
    db
      .select({ weekday: availabilityRules.weekday, startMinute: availabilityRules.startMinute, endMinute: availabilityRules.endMinute })
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
      .where(and(gte(availabilityExceptions.date, from), lte(availabilityExceptions.date, to))),
  ]);

  const days: { date: string; open: { startMinute: number; endMinute: number }[] }[] = [];
  for (let date = from; date <= to; date = addDaysToDate(date, 1)) {
    days.push({ date, open: openWindowsFor(date, rules, exceptions) });
  }
  return { days };
}
