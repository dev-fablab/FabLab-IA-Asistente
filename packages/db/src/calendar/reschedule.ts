import { and, eq, gt, lt, ne, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { meetings } from '../schema';
import { getOpenWindows } from './availability';
import { isOverlapViolation } from './booking';
import { dateInTimeZone, minuteOfDayInTimeZone } from './slots';

export type RescheduleResult =
  | { status: 'moved'; startsAt: Date; endsAt: Date }
  | { status: 'not_found' }
  /** Solo se mueven las reuniones agendadas: una realizada o cancelada ya no ocupa el calendario. */
  | { status: 'not_scheduled' }
  | { status: 'in_past' }
  /** El bloque no cabe entero en una ventana de atención (horario base más excepciones). */
  | { status: 'outside_hours' }
  | { status: 'slot_taken' };

/**
 * Mueve una reunión agendada a otro horario, conservando su duración. Es lo que usa el equipo al reagendar
 * (arrastrando en el calendario o desde el detalle). A diferencia de una reserva nueva no exige la rejilla de
 * bloques ni la anticipación mínima, pero sí lo esencial: el bloque entero dentro del horario de atención, que
 * no esté en el pasado y que no choque con otra reunión agendada.
 */
export async function rescheduleMeeting({ id, startsAt, now = new Date() }: { id: string; startsAt: Date; now?: Date }): Promise<RescheduleResult> {
  try {
    return await getDb().transaction(async (tx): Promise<RescheduleResult> => {
      // El mismo lock que las reservas: las dos operaciones compiten por los mismos horarios.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fablab.meetings'))`);

      const [meeting] = await tx
        .select({ startsAt: meetings.startsAt, endsAt: meetings.endsAt, status: meetings.status })
        .from(meetings)
        .where(eq(meetings.id, id));
      if (!meeting) return { status: 'not_found' };
      if (meeting.status !== 'scheduled') return { status: 'not_scheduled' };

      const durationMs = meeting.endsAt.getTime() - meeting.startsAt.getTime();
      const endsAt = new Date(startsAt.getTime() + durationMs);
      if (startsAt.getTime() === meeting.startsAt.getTime()) return { status: 'moved', startsAt, endsAt };
      if (startsAt < now) return { status: 'in_past' };

      const date = dateInTimeZone(startsAt);
      const startMinute = minuteOfDayInTimeZone(startsAt);
      const endMinute = startMinute + Math.round(durationMs / 60_000);
      // Una reunión no cruza la medianoche: las ventanas de atención son de un solo día.
      const windows = dateInTimeZone(new Date(endsAt.getTime() - 1)) === date ? await getOpenWindows(date, tx) : [];
      if (!windows.some((window) => window.startMinute <= startMinute && endMinute <= window.endMinute)) return { status: 'outside_hours' };

      const [clash] = await tx
        .select({ id: meetings.id })
        .from(meetings)
        .where(and(eq(meetings.status, 'scheduled'), ne(meetings.id, id), lt(meetings.startsAt, endsAt), gt(meetings.endsAt, startsAt)))
        .limit(1);
      if (clash) return { status: 'slot_taken' };

      await tx.update(meetings).set({ startsAt, endsAt, updatedAt: new Date() }).where(eq(meetings.id, id));
      return { status: 'moved', startsAt, endsAt };
    });
  } catch (error) {
    if (isOverlapViolation(error)) return { status: 'slot_taken' };
    throw error;
  }
}
