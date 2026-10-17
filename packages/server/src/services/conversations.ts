import { conversations, getDb, messages } from '@fablab/db';
import { and, asc, desc, eq, exists, ilike, or, sql, type SQL } from 'drizzle-orm';
import { notFound } from '../errors';

export const CONVERSATIONS_PAGE_SIZE = 25;

/** Las fechas del filtro son días calendario en la zona horaria de Fab Lab. */
const TIME_ZONE = 'America/Santiago';

export type ConversationFilters = {
  page: number;
  /** Solo conversaciones con respuestas «sin información» (RF-21). */
  noAnswer?: boolean | undefined;
  /** Día inicial y final (incluidos), `YYYY-MM-DD`. */
  from?: string | undefined;
  to?: string | undefined;
  /** Texto a buscar dentro de las conversaciones (RF-22). */
  q?: string | undefined;
};

/** Escapa `%`, `_` y `\` para que la búsqueda se trate como texto literal en un LIKE. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildWhere({ noAnswer, from, to, q }: ConversationFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (noAnswer) conditions.push(eq(conversations.hasNoAnswer, true));

  // La fecha de una conversación es la de su última actividad: es también el orden de la lista.
  if (from) {
    conditions.push(sql`${conversations.lastMessageAt} >= (${from}::date)::timestamp at time zone ${TIME_ZONE}`);
  }
  if (to) {
    conditions.push(sql`${conversations.lastMessageAt} < ((${to}::date + 1)::timestamp at time zone ${TIME_ZONE})`);
  }

  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      or(
        ilike(conversations.firstMessage, pattern),
        exists(
          getDb()
            .select({ one: sql`1` })
            .from(messages)
            .where(and(eq(messages.conversationId, conversations.id), ilike(messages.content, pattern))),
        ),
      )!,
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Lista paginada (25 por página, las más recientes primero) con filtros opcionales. */
export async function listConversations(filters: ConversationFilters) {
  const db = getDb();
  const where = buildWhere(filters);

  const [{ total = 0 } = {}] = await db.select({ total: sql<number>`count(*)::int` }).from(conversations).where(where);

  const items = await db
    .select({
      id: conversations.id,
      createdAt: conversations.createdAt,
      lastMessageAt: conversations.lastMessageAt,
      firstMessage: conversations.firstMessage,
      messageCount: conversations.messageCount,
      hasNoAnswer: conversations.hasNoAnswer,
      channel: conversations.channel,
    })
    .from(conversations)
    .where(where)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(CONVERSATIONS_PAGE_SIZE)
    .offset((filters.page - 1) * CONVERSATIONS_PAGE_SIZE);

  return {
    items,
    page: filters.page,
    pageSize: CONVERSATIONS_PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / CONVERSATIONS_PAGE_SIZE)),
  };
}

/** Una conversación con todos sus mensajes, en orden y con la marca «sin información». */
export async function getConversationDetail(id: string) {
  const db = getDb();
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conversation) throw notFound('Conversación no encontrada');

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      noAnswer: messages.noAnswer,
      modality: messages.modality,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  return { conversation, messages: rows };
}
