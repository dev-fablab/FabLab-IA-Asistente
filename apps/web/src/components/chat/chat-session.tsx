'use client';

import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';
import { useMemo, useState } from 'react';
import { SUGGESTED_QUESTIONS } from '@/lib/chat/copy';
import { useVoice, VoiceContext } from '@/lib/voice/use-voice';
import { useReportMascotMood } from './mascot/use-report-mascot-mood';
import { Thread } from './thread';
import { VoiceStage } from './voice-stage';

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
  const [heard] = useState(() => new Map<string, string>());
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: '/api/chat',
        // Solo lo que la API espera. Por defecto el transporte enviaría el id interno del hilo de
        // Assistant UI y, además, `system` y `tools` del cliente; el servidor los ignora, pero
        // aquí tampoco salen del navegador.
        prepareSendMessagesRequest: ({ messages, trigger }) => {
          const metadata = messages.findLast((message) => message.role === 'user')?.metadata as { custom?: { channel?: string } } | undefined;
          return { body: {
            id: conversationId,
            messages: messages.map((message) => heard.has(message.id)
              ? { ...message, parts: [{ type: 'text', text: heard.get(message.id)! }] }
              : message),
            trigger,
            ...(metadata?.custom?.channel === 'voice' && { channel: 'voice' }),
          } };
        },
      }),
    [conversationId, heard],
  );

  const runtime = useChatRuntime({ transport, messages: initialMessages, suggestions: SUGGESTIONS });
  const voice = useVoice(runtime, heard);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <VoiceContext.Provider value={voice}>
        <MascotSync />
        <VoiceStage><Thread /></VoiceStage>
      </VoiceContext.Provider>
    </AssistantRuntimeProvider>
  );
}
