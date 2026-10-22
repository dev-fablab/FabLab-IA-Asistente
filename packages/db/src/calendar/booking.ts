import { and, count, eq, gt, ne, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { contacts, meetingMinutes, meetings } from '../schema';
import { getAvailability, type Executor } from './availability';
import { addDaysToDate, dateInTimeZone, MAX_DAYS_AHEAD, MEETING_DURATION_MINUTES } from './slots';

/** Reuniones futuras sin cancelar que puede tener un mismo correo. */
export const MAX_ACTIVE_MEETINGS_PER_CONTACT = 2;
/** Reuniones sin cancelar que puede originar una misma conversación. */
export const MAX_MEETINGS_PER_CONVERSATION = 2;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** ¿Hay un contacto con este correo? La herramienta solo expone este dato, nunca el nombre guardado. */
export async function contactExists(email: string, db: Executor = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`lower(${contacts.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return row !== undefined;
}

export type BookMeetingInput = {
  email: string;
  /** Obligatorio solo si el correo aún no es un contacto. Un contacto existente conserva su nombre. */
  name?: string | undefined;
  reason: string;
  startsAt: Date;
  conversationId?: string | null | undefined;
  conversationSummary?: string | null | undefined;
  /** Puntos con los que el agente prellena el acta. */
  keyPoints?: string[] | undefined;
  now?: Date;
};

export type BookMeetingResult =
  | { status: 'booked'; meeting: { id: string; startsAt: Date; endsAt: Date }; contactIsNew: boolean }
  | { status: 'slot_unavailable' }
  | { status: 'name_required' }
  | { status: 'limit_reached'; limit: 'contact' | 'conversation' };

/**
 * La restricción de exclusión rechazó el horario (23P01) o dos reservas simultáneas del mismo bloque se
 * esperaron entre sí y Postgres abortó una (40P01). Drizzle envuelve el error de Postgres en `cause`.
 */
export function isOverlapViolation(error: unknown): boolean {
  const code = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined);
  const codes = [code(error), code((error as { cause?: unknown } | null)?.cause)];
  return codes.includes('23P01') || codes.includes('40P01');
}

/**
 * Agenda una reunión. En una sola transacción: el horario debe seguir libre según la misma
 * disponibilidad que se ofreció, se respetan los topes por correo y conversación, se crea el contacto si
 * no existe y se guardan la reunión y los puntos del acta. La restricción de exclusión de la base cierra
 * la carrera entre dos reservas simultáneas del mismo horario.
 */
export async function bookMeeting(input: BookMeetingInput): Promise<BookMeetingResult> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const name = input.name?.trim();
  const { startsAt } = input;
  const endsAt = new Date(startsAt.getTime() + MEETING_DURATION_MINUTES * 60_000);

  const date = dateInTimeZone(startsAt);
  if (date > addDaysToDate(dateInTimeZone(now), MAX_DAYS_AHEAD)) return { status: 'slot_unavailable' };

  try {
    return await getDb().transaction(async (tx): Promise<BookMeetingResult> => {
      // Las reservas se serializan: sin esto, dos transacciones sobre el mismo bloque se esperan entre sí
      // en la restricción de exclusión y Postgres aborta una por deadlock. El volumen de reservas es bajo.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fablab.meetings'))`);
      const [availability] = (await getAvailability({ from: date, days: 1, now }, tx)).days;
      const isFree = availability?.date === date && availability.free.some((slot) => slot.start.getTime() === startsAt.getTime());
      if (!isFree) return { status: 'slot_unavailable' };

      const [existing] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(sql`lower(${contacts.email}) = ${email}`)
        .limit(1);
      if (!existing && !name) return { status: 'name_required' };

      if (existing) {
        const [{ active = 0 } = {}] = await tx
          .select({ active: count() })
          .from(meetings)
          .where(and(eq(meetings.contactId, existing.id), eq(meetings.status, 'scheduled'), gt(meetings.endsAt, now)));
        if (active >= MAX_ACTIVE_MEETINGS_PER_CONTACT) return { status: 'limit_reached', limit: 'contact' };
      }
      if (input.conversationId) {
        const [{ total = 0 } = {}] = await tx
          .select({ total: count() })
          .from(meetings)
          .where(and(eq(meetings.conversationId, input.conversationId), ne(meetings.status, 'cancelled')));
        if (total >= MAX_MEETINGS_PER_CONVERSATION) return { status: 'limit_reached', limit: 'conversation' };
      }

      const contactId =
        existing?.id ?? (await tx.insert(contacts).values({ name: name!, email, source: 'chat' }).returning({ id: contacts.id }))[0]!.id;

      const [meeting] = await tx
        .insert(meetings)
        .values({
          contactId,
          conversationId: input.conversationId ?? null,
          startsAt,
          endsAt,
          reason: input.reason.trim(),
          conversationSummary: input.conversationSummary?.trim() || null,
        })
        .returning({ id: meetings.id, startsAt: meetings.startsAt, endsAt: meetings.endsAt });

      const points = (input.keyPoints ?? []).map((point) => point.trim()).filter(Boolean);
      if (points.length > 0) {
        await tx
          .insert(meetingMinutes)
          .values(points.map((content, index) => ({ meetingId: meeting!.id, content, source: 'agent' as const, sortOrder: index })));
      }
      return { status: 'booked', meeting: meeting!, contactIsNew: !existing };
    });
  } catch (error) {
    if (isOverlapViolation(error)) return { status: 'slot_unavailable' };
    throw error;
  }
}
