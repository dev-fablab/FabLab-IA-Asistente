'use client';

import { MessageSquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  loadInitialConversation,
  newConversationId,
  writeConversationId,
  type InitialConversation,
} from '@/lib/chat/conversation';
import { ChatSession } from './chat-session';
import { Mascot } from './mascot/mascot';

/**
 * Chat público. Retoma la conversación guardada en el navegador (RF-09) y permite empezar otra.
 * El identificador vive en `localStorage` y viaja en cada petición como `id`.
 */
export function ChatApp() {
  const [conversation, setConversation] = useState<InitialConversation | null>(null);

  useEffect(() => {
    let ignore = false;
    loadInitialConversation().then((loaded) => {
      if (!ignore) setConversation(loaded);
    });
    return () => {
      ignore = true;
    };
  }, []);

  function startNewConversation() {
    const conversationId = newConversationId();
    writeConversationId(conversationId);
    setConversation({ conversationId, initialMessages: [] });
  }

  return (
    <TooltipProvider>
      <div className="flex h-full w-full flex-col">
        {/* La barra superior ocupa todo el ancho de la pantalla; el contenido del chat queda centrado en 760 px. */}
        <header className="flex shrink-0 items-center justify-between gap-2 border-t-[3px] border-brand border-b border-b-border px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Mascot size={44} className="shrink-0" calm />
            <div className="flex flex-col leading-tight">
              <h1 className="text-base font-semibold">Asistente de Fab Lab</h1>
              <span className="text-xs text-muted-foreground">INACAP Talca</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={startNewConversation} disabled={!conversation}>
            <MessageSquarePlus aria-hidden /> Nueva conversación
          </Button>
        </header>

        <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col">
          {conversation ? (
            <ChatSession
              key={conversation.conversationId}
              conversationId={conversation.conversationId}
              initialMessages={conversation.initialMessages}
            />
          ) : (
            <div className="flex flex-col gap-3 p-4" role="status" aria-label="Cargando la conversación">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
