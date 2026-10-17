'use client';

import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';
import { useMemo } from 'react';
import { SUGGESTED_QUESTIONS } from '@/lib/chat/copy';
import { useReportMascotMood } from './mascot/use-report-mascot-mood';
import { Thread } from './thread';

const SUGGESTIONS = SUGGESTED_QUESTIONS.map((question) => ({ title: question, label: '', prompt: question }));

type Props = {
  conversationId: string;
  initialMessages: UIMessage[];
};

/**
 * Una conversación: el runtime de Assistant UI sobre el AI SDK, conectado a `POST /api/chat`.
 * Se monta con `key={conversationId}`, así «Nueva conversación» crea un runtime limpio.
 */
/** Publica el ánimo de la mascota; vive dentro del runtime porque lee el estado del hilo. */
function MascotSync() {
  useReportMascotMood();
  return null;
}

export function ChatSession({ conversationId, initialMessages }: Props) {
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: '/api/chat',
        // Solo lo que la API espera. Por defecto el transporte enviaría el id interno del hilo de
        // Assistant UI y, además, `system` y `tools` del cliente; el servidor los ignora, pero
        // aquí tampoco salen del navegador.
        prepareSendMessagesRequest: ({ messages, trigger }) => ({
          body: { id: conversationId, messages, trigger },
        }),
      }),
    [conversationId],
  );

  const runtime = useChatRuntime({ transport, messages: initialMessages, suggestions: SUGGESTIONS });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MascotSync />
      <Thread />
    </AssistantRuntimeProvider>
  );
}
