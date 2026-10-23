import { contacts, getDb, isOverlapViolation, meetingMinutes, meetings, profiles, rescheduleMeeting, type MeetingStatus } from '@fablab/db';
import { and, asc, eq, gt, lt, max, ne, sql } from 'drizzle-orm';
import { badRequest, conflict, notFound } from '../errors';
import { listContactMethods } from './people';

/** Rango máximo de una consulta: cubre el mes completo con las semanas de los bordes. */
export const MAX_RANGE_DAYS = 100;
export const DEFAULT_MANUAL_MEETING_DURATION_MINUTES = 60;

/** Reuniones que tocan el rango, sin las canceladas (liberan el horario). */
export async function listMeetings({ from, to }: { from: Date; to: Date }) {
  const items = await getDb()
    .select({
      id: meetings.id,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      status: meetings.status,
      reason: meetings.reason,
      contactName: contacts.name,
      contactEmail: contacts.email,
      responsibleId: meetings.responsibleId,
      // Sin nombre cargado se muestra el correo: siempre hay algo que mostrar.
      responsibleName: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.email})`,
    })
    .from(meetings)
    .innerJoin(contacts, eq(meetings.contactId, contacts.id))
    .leftJoin(profiles, eq(meetings.responsibleId, profiles.id))
    .where(and(ne(meetings.status, 'cancelled'), lt(meetings.startsAt, to), gt(meetings.endsAt, from)))
    .orderBy(asc(meetings.startsAt));
  return { items };
}

export type ManualMeetingInput = {
  contactId: string;
  responsibleId: string;
  startsAt: Date;
  durationMinutes: number;
  reason: string;
};

/** Crea una reserva desde el panel: exige datos existentes y solo aplica la regla de no solapamiento. */
export async function createManualMeeting(input: ManualMeetingInput) {
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  try {
    const id = await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fablab.meetings'))`);

      const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId));
      if (!contact) throw badRequest('El asociado seleccionado no existe');

      const [responsible] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, input.responsibleId));
      if (!responsible) throw badRequest('El responsable seleccionado no existe');

      const [meeting] = await tx
        .insert(meetings)
        .values({
          contactId: input.contactId,
          responsibleId: input.responsibleId,
          startsAt: input.startsAt,
          endsAt,
          reason: input.reason.trim(),
        })
        .returning({ id: meetings.id });
      return meeting!.id;
    });
    return getMeetingDetail(id);
  } catch (error) {
    if (isOverlapViolation(error)) throw conflict('Ese horario ya lo ocupa otra reunión');
    throw error;
  }
}

/** Una reunión con su solicitante, el resumen de la conversación que la originó y el acta. */
export async function getMeetingDetail(id: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: meetings.id,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      status: meetings.status,
      reason: meetings.reason,
      conversationSummary: meetings.conversationSummary,
      conversationId: meetings.conversationId,
      createdAt: meetings.createdAt,
      responsibleId: meetings.responsibleId,
      contact: { id: contacts.id, name: contacts.name, email: contacts.email, source: contacts.source },
    })
    .from(meetings)
    .innerJoin(contacts, eq(meetings.contactId, contacts.id))
    .where(eq(meetings.id, id));
  if (!row) throw notFound('Reunión no encontrada');

  const [responsible = null] = row.responsibleId
    ? await db
        .select({ id: profiles.id, name: sql<string>`coalesce(${profiles.fullName}, ${profiles.email})`, email: profiles.email, role: profiles.role })
        .from(profiles)
        .where(eq(profiles.id, row.responsibleId))
    : [];

  const minutes = await db
    .select({ id: meetingMinutes.id, content: meetingMinutes.content, source: meetingMinutes.source, createdAt: meetingMinutes.createdAt })
    .from(meetingMinutes)
    .where(eq(meetingMinutes.meetingId, id))
    .orderBy(asc(meetingMinutes.sortOrder), asc(meetingMinutes.createdAt));

  // El detalle muestra cómo ubicar a la persona: el correo y los medios adicionales que haya cargado el equipo.
  const methods = await listContactMethods(row.contact.id);
  return { meeting: { ...row, contact: { ...row.contact, methods } }, responsible, minutes };
}

/** Cambia el estado. Reactivar una cancelada puede chocar con otra reunión que tomó el horario. */
export async function setMeetingStatus(id: string, status: MeetingStatus) {
  try {
    const updated = await getDb()
      .update(meetings)
      .set({ status, updatedAt: new Date() })
      .where(eq(meetings.id, id))
      .returning({ id: meetings.id });
    if (updated.length === 0) throw notFound('Reunión no encontrada');
  } catch (error) {
    if (isOverlapViolation(error)) throw conflict('Ese horario ya lo ocupa otra reunión');
    throw error;
  }
  return getMeetingDetail(id);
}

/** Agrega un punto al final del acta, escrito por el equipo. */
export async function addMinute(meetingId: string, content: string) {
  const db = getDb();
  const [exists] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, meetingId));
  if (!exists) throw notFound('Reunión no encontrada');

  const [{ last } = { last: null }] = await db
    .select({ last: max(meetingMinutes.sortOrder) })
    .from(meetingMinutes)
    .where(eq(meetingMinutes.meetingId, meetingId));
  const [minute] = await db
    .insert(meetingMinutes)
    .values({ meetingId, content, source: 'staff', sortOrder: (last ?? -1) + 1 })
    .returning({ id: meetingMinutes.id, content: meetingMinutes.content, source: meetingMinutes.source, createdAt: meetingMinutes.createdAt });
  return minute!;
}

export async function updateMinute(id: string, content: string) {
  const [minute] = await getDb()
    .update(meetingMinutes)
    .set({ content, updatedAt: sql`now()` })
    .where(eq(meetingMinutes.id, id))
    .returning({ id: meetingMinutes.id, content: meetingMinutes.content, source: meetingMinutes.source, createdAt: meetingMinutes.createdAt });
  if (!minute) throw notFound('Punto del acta no encontrado');
  return minute;
}

export async function deleteMinute(id: string): Promise<void> {
  const deleted = await getDb().delete(meetingMinutes).where(eq(meetingMinutes.id, id)).returning({ id: meetingMinutes.id });
  if (deleted.length === 0) throw notFound('Punto del acta no encontrado');
}

/** La persona debe existir en el equipo (staff o admin); cualquiera de los dos roles puede ser responsable. */
async function assertTeamMember(profileId: string): Promise<void> {
  const [profile] = await getDb().select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId));
  if (!profile) throw badRequest('Esa persona no es parte del equipo');
}

/** Asigna (o quita con `null`) a quien lleva la reunión. Cualquier persona del equipo, staff o admin, puede serlo. */
export async function setMeetingResponsible(id: string, responsibleId: string | null) {
  if (responsibleId !== null) await assertTeamMember(responsibleId);
  const updated = await getDb()
    .update(meetings)
    .set({ responsibleId, updatedAt: new Date() })
    .where(eq(meetings.id, id))
    .returning({ id: meetings.id });
  if (updated.length === 0) throw notFound('Reunión no encontrada');
}

/** Reagenda una reunión agendada; el motivo del rechazo viaja en el mensaje para mostrarlo al equipo. */
export async function moveMeeting(id: string, startsAt: Date) {
  const result = await rescheduleMeeting({ id, startsAt });
  switch (result.status) {
    case 'moved':
      return;
    case 'not_found':
      throw notFound('Reunión no encontrada');
    case 'not_scheduled':
      throw conflict('Solo se pueden mover las reuniones agendadas');
    case 'in_past':
      throw badRequest('No se puede mover una reunión al pasado');
    case 'outside_hours':
      throw badRequest('Ese horario está fuera del horario de atención');
    case 'slot_taken':
      throw conflict('Ese horario ya lo ocupa otra reunión');
  }
}

export type MeetingPatch = { status?: MeetingStatus | undefined; startsAt?: Date | undefined; responsibleId?: string | null | undefined };

/**
 * Cambios del equipo sobre una reunión. Lo que puede rechazarse se hace antes que lo que no: se comprueba que
 * existan la reunión y la persona responsable, luego se intenta el cambio de horario (el que más veces falla) y
 * recién después se escribe el resto. Así un reagendado rechazado no deja el responsable ni el estado a medias.
 */
export async function updateMeeting(id: string, patch: MeetingPatch) {
  const [exists] = await getDb().select({ id: meetings.id }).from(meetings).where(eq(meetings.id, id));
  if (!exists) throw notFound('Reunión no encontrada');
  if (patch.responsibleId) await assertTeamMember(patch.responsibleId);

  if (patch.startsAt) await moveMeeting(id, patch.startsAt);
  if (patch.responsibleId !== undefined) await setMeetingResponsible(id, patch.responsibleId);
  if (patch.status) return setMeetingStatus(id, patch.status);
  return getMeetingDetail(id);
}
