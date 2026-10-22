import { asc, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { contacts, meetings, type MeetingStatus } from '../schema';
import type { Executor } from './availability';

/** Cuántas reuniones de una conversación se informan al agente: más que los topes de reserva. */
const MAX_LISTED = 5;

export type ConversationMeeting = {
  startsAt: Date;
  endsAt: Date;
  status: MeetingStatus;
  reason: string;
  contactName: string;
};

/**
 * Las reuniones que se agendaron desde una conversación. Es la fuente de verdad que se le da al agente en
 * cada turno: el hilo que reenvía el navegador no trae los resultados de las herramientas (el servidor los
 * descarta), así que sin esto el agente no sabría si una reserva se concretó.
 */
export async function listConversationMeetings(conversationId: string, db: Executor = getDb()): Promise<ConversationMeeting[]> {
  return db
    .select({
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      status: meetings.status,
      reason: meetings.reason,
      contactName: contacts.name,
    })
    .from(meetings)
    .innerJoin(contacts, eq(meetings.contactId, contacts.id))
    .where(eq(meetings.conversationId, conversationId))
    .orderBy(asc(meetings.startsAt))
    .limit(MAX_LISTED);
}
