import type { UIMessage } from 'ai';
import { publicApi } from '@/lib/api';

/** Clave de `localStorage` con el identificador de la conversación (RF-09). */
export const CONVERSATION_STORAGE_KEY = 'fablab.conversationId';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `localStorage` puede fallar (modo privado, datos bloqueados): la página funciona igual sin él. */
export function readConversationId(): string | null {
  try {
    const stored = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
    return stored && UUID.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeConversationId(id: string): void {
  try {
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
  } catch {
    // Sin almacenamiento la conversación sigue, pero no se podrá retomar tras recargar.
  }
}

/** Un UUID nuevo por conversación; el servidor lo usa como identificador de `conversations`. */
export function newConversationId(): string {
  return crypto.randomUUID();
}

type HistoryRow = { id: string; role: 'user' | 'assistant'; content: string };

/** Mensajes guardados → mensajes de UI del AI SDK, solo con su texto. */
export function toUiMessages(rows: HistoryRow[]): UIMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: [{ type: 'text', text: row.content }],
  }));
}

export type InitialConversation = { conversationId: string; initialMessages: UIMessage[] };

/**
 * Conversación con la que arranca la página: la guardada en el navegador con sus mensajes, o una
 * nueva. Si el historial no se puede leer se empieza de cero con ese mismo identificador.
 */
export async function loadInitialConversation(): Promise<InitialConversation> {
  const stored = readConversationId();
  if (!stored) {
    const conversationId = newConversationId();
    writeConversationId(conversationId);
    return { conversationId, initialMessages: [] };
  }

  try {
    const response = await publicApi.api.chat.history.$get({ query: { conversationId: stored } });
    if (!response.ok) return { conversationId: stored, initialMessages: [] };
    const { messages } = (await response.json()) as { messages: HistoryRow[] };
    return { conversationId: stored, initialMessages: toUiMessages(messages) };
  } catch {
    return { conversationId: stored, initialMessages: [] };
  }
}
