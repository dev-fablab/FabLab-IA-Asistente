import { conversations, getDb, messages, type Database } from '@fablab/db';
import { desc, eq, sql } from 'drizzle-orm';

// El historial no depende de Hono: lo reutilizará el worker de voz de la Fase 3.

type Channel = 'web' | 'voice';
type Modality = 'text' | 'voice';
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** `first_message` se muestra en la lista del panel: se guarda recortado. */
const FIRST_MESSAGE_MAX = 500;

/** Recalcula los contadores desde los mensajes: más robusto que incrementarlos. */
async function refreshConversation(tx: Transaction, conversationId: string) {
  await tx
    .update(conversations)
    .set({
      messageCount: sql`(select count(*)::int from ${messages} where ${messages.conversationId} = ${conversationId})`,
      hasNoAnswer: sql`exists (select 1 from ${messages} where ${messages.conversationId} = ${conversationId} and ${messages.noAnswer})`,
      lastMessageAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

async function latestMessage(tx: Transaction, conversationId: string) {
  const [row] = await tx
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row;
}

export type SaveUserMessageOptions = {
  /** Reintento de la última respuesta: reemplaza la respuesta anterior en lugar de duplicarla. */
  regenerate?: boolean;
  channel?: Channel;
  modality?: Modality;
};

/**
 * Guarda el mensaje de la persona, creando la conversación si no existe. Es idempotente: si el
 * último mensaje guardado es ese mismo texto (un reintento tras un error) no lo duplica, y en una
 * regeneración descarta primero la respuesta anterior del asistente.
 */
export async function saveUserMessage(
  conversationId: string,
  content: string,
  { regenerate = false, channel = 'web', modality = 'text' }: SaveUserMessageOptions = {},
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .insert(conversations)
      .values({ id: conversationId, channel, firstMessage: content.slice(0, FIRST_MESSAGE_MAX) })
      .onConflictDoNothing();

    // Una conversación puede mezclar texto y voz; el canal queda marcado desde el primer turno hablado.
    if (channel === 'voice') {
      await tx.update(conversations).set({ channel: 'voice' }).where(eq(conversations.id, conversationId));
    }

    let last = await latestMessage(tx, conversationId);
    if (regenerate && last?.role === 'assistant') {
      await tx.delete(messages).where(eq(messages.id, last.id));
      last = await latestMessage(tx, conversationId);
    }

    if (!(last?.role === 'user' && last.content === content)) {
      await tx.insert(messages).values({ conversationId, role: 'user', content, modality });
    }
    await refreshConversation(tx, conversationId);
  });
}

export type AssistantMessage = {
  /** Texto en markdown tal como lo vio la persona. */
  content: string;
  /** La última búsqueda del turno no encontró respaldo documental. */
  noAnswer: boolean;
  modality?: Modality;
};

/** Guarda la respuesta del asistente y actualiza los contadores y la marca «sin información». */
export async function saveAssistantMessage(
  conversationId: string,
  { content, noAnswer, modality = 'text' }: AssistantMessage,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.insert(messages).values({ conversationId, role: 'assistant', content, noAnswer, modality });
    await refreshConversation(tx, conversationId);
  });
}

/** Mensajes de una conversación para retomarla tras recargar la página (RF-09). */
export async function getConversationMessages(conversationId: string, limit = 100) {
  const rows = await getDb()
    .select({ id: messages.id, role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  // Se piden los más recientes y se entregan en orden cronológico.
  return rows.reverse();
}
