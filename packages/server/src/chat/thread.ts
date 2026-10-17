import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { badRequest } from '../errors';

/** Mensajes del hilo que se envían al modelo (controla costo y latencia). */
export const MAX_THREAD_MESSAGES = 20;
/** Largo máximo de un mensaje de la persona (spec §9). */
export const MAX_USER_MESSAGE_CHARS = 2000;
const MAX_ASSISTANT_CHARS = 8000;

/** Forma mínima de un mensaje de UI del AI SDK; el resto de los campos se ignora. */
const uiMessageSchema = z.looseObject({
  id: z.string().max(200).optional(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.looseObject({ type: z.string() })).max(100),
});

export const chatBodySchema = z.object({
  /** Identificador de la conversación: un UUID que genera el navegador. */
  id: z.uuid(),
  messages: z.array(uiMessageSchema).min(1).max(500),
  trigger: z.enum(['submit-message', 'regenerate-message']).optional(),
  channel: z.enum(['web', 'voice']).optional(),
});

export type ChatBody = z.infer<typeof chatBodySchema>;

export type ThreadMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: { type: 'text'; text: string }[];
};

function textOf(message: ChatBody['messages'][number]): string {
  return message.parts
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

/**
 * Deja el hilo listo para el modelo. El cliente es la fuente del hilo (el agente no tiene
 * estado), así que nada de lo que envía se toma al pie de la letra:
 *
 * - se rechazan los mensajes de `system`, que permitirían inyectar instrucciones;
 * - solo se conserva el texto: se descartan las partes de herramientas, así nadie puede
 *   falsificar resultados de `searchDocuments` para que el agente los dé por buenos;
 * - se recorta a los últimos 20 mensajes y se exige que termine en un mensaje de la persona.
 */
export function sanitizeThread(messages: ChatBody['messages']): ThreadMessage[] {
  if (messages.some((message) => message.role === 'system')) {
    throw badRequest('Los mensajes de sistema no están permitidos');
  }

  const thread = messages
    .map((message): ThreadMessage | null => {
      const role = message.role as 'user' | 'assistant';
      const text = textOf(message);
      if (!text) return null;
      if (role === 'user' && text.length > MAX_USER_MESSAGE_CHARS) {
        throw badRequest(`El mensaje es demasiado largo (máximo ${MAX_USER_MESSAGE_CHARS.toLocaleString('es-CL')} caracteres)`);
      }
      return {
        id: message.id ?? randomUUID(),
        role,
        parts: [{ type: 'text', text: role === 'assistant' ? text.slice(0, MAX_ASSISTANT_CHARS) : text }],
      };
    })
    .filter((message): message is ThreadMessage => message !== null)
    .slice(-MAX_THREAD_MESSAGES);

  if (thread.at(-1)?.role !== 'user') {
    throw badRequest('La conversación debe terminar con un mensaje de la persona');
  }
  return thread;
}

/** Texto del último mensaje de la persona en un hilo ya saneado. */
export function lastUserText(thread: ThreadMessage[]): string {
  return thread.at(-1)!.parts[0]!.text;
}
