'use client';

import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
} from '@assistant-ui/react';
import { ArrowUp, Check, Copy, RefreshCw, Square } from 'lucide-react';
import { useRef, type FC } from 'react';
import { MarkdownText } from '@/components/assistant-ui/elements/markdown-text';
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { Button } from '@/components/ui/button';
import { MAX_MESSAGE_CHARS, PRIVACY_NOTICE } from '@/lib/chat/copy';
import { ChatError } from './chat-error';
import { Mascot } from './mascot/mascot';
import { toolUIs } from './tool-uis';
import { TypingIndicator } from './typing-indicator';
import { useForwardWheel } from './use-forward-wheel';

const isEmptyThread = (s: { thread: { messages: readonly unknown[] } }) => s.thread.messages.length === 0;

const Welcome: FC = () => (
  <section className="flex flex-col gap-4 py-6" aria-labelledby="welcome-title">
    <Mascot size={120} className="self-center" />
    <div className="flex flex-col gap-2">
      <h2 id="welcome-title" className="text-2xl font-semibold tracking-tight">
        ¡Hola! Soy el asistente virtual de Fab Lab
      </h2>
      <p className="text-muted-foreground">
        Respondo con la documentación oficial de Fab Lab. Pregúntame lo que necesites o elige una de estas preguntas.
      </p>
    </div>
    <div className="flex flex-col gap-2" role="group" aria-label="Preguntas sugeridas">
      <ThreadPrimitive.Suggestions>
        {() => (
          <SuggestionPrimitive.Trigger send asChild>
            <button
              type="button"
              className="rounded-xl border bg-card px-4 py-3 text-start text-sm transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SuggestionPrimitive.Title />
            </button>
          </SuggestionPrimitive.Trigger>
        )}
      </ThreadPrimitive.Suggestions>
    </div>
  </section>
);

const UserMessage: FC = () => (
  <MessagePrimitive.Root data-role="user" className="flex justify-end px-2">
    <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2 text-primary-foreground wrap-break-word whitespace-pre-wrap">
      <MessagePrimitive.Parts />
    </div>
  </MessagePrimitive.Root>
);

const AssistantActionBar: FC = () => (
  <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="-ms-1 flex gap-1 text-muted-foreground">
    <ActionBarPrimitive.Copy asChild>
      <TooltipIconButton tooltip="Copiar respuesta">
        <AuiIf condition={(s) => s.message.isCopied}>
          <Check />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <Copy />
        </AuiIf>
      </TooltipIconButton>
    </ActionBarPrimitive.Copy>
    <ActionBarPrimitive.Reload asChild>
      <TooltipIconButton tooltip="Generar otra respuesta">
        <RefreshCw />
      </TooltipIconButton>
    </ActionBarPrimitive.Reload>
  </ActionBarPrimitive.Root>
);

const AssistantMessage: FC = () => {
  const running = useAuiState((s) => s.message.status?.type === 'running');

  return (
    <MessagePrimitive.Root data-role="assistant" className="flex flex-col gap-1 px-2">
      <div className="leading-relaxed wrap-break-word">
        <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: toolUIs }} />
        {running && <TypingIndicator />}
        <ChatError />
      </div>
      <AssistantActionBar />
    </MessagePrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  return role === 'user' ? <UserMessage /> : <AssistantMessage />;
};

const Composer: FC = () => (
  <ComposerPrimitive.Root className="flex items-end gap-2 rounded-2xl border bg-muted/30 p-2 transition-colors focus-within:border-foreground/30">
    <ComposerPrimitive.Input
      placeholder="Escribe tu pregunta…"
      aria-label="Escribe tu mensaje"
      rows={1}
      maxLength={MAX_MESSAGE_CHARS}
      enterKeyHint="send"
      className="max-h-40 min-h-10 w-full resize-none bg-transparent px-2.5 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground"
    />
    <AuiIf condition={(s) => !s.thread.isRunning}>
      <ComposerPrimitive.Send asChild>
        <Button type="submit" size="icon" className="shrink-0 rounded-full" aria-label="Enviar mensaje">
          <ArrowUp />
        </Button>
      </ComposerPrimitive.Send>
    </AuiIf>
    <AuiIf condition={(s) => s.thread.isRunning}>
      <ComposerPrimitive.Cancel asChild>
        <Button type="button" size="icon" className="shrink-0 rounded-full" aria-label="Detener respuesta">
          <Square className="fill-current" />
        </Button>
      </ComposerPrimitive.Cancel>
    </AuiIf>
  </ComposerPrimitive.Root>
);

/** Hilo del chat: se diseña primero para móvil y se limita a 760 px de ancho (el contenedor lo fija). */
export const Thread: FC = () => {
  const viewport = useRef<HTMLDivElement>(null);
  useForwardWheel(viewport);

  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col bg-background">
      <ThreadPrimitive.Viewport
        ref={viewport}
        role="log"
        aria-label="Conversación con el asistente"
        className="flex flex-1 flex-col gap-6 overflow-y-auto overscroll-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-2 pt-2 pb-4"
      >
        <AuiIf condition={isEmptyThread}>
          <Welcome />
        </AuiIf>
        <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>

      <div className="px-4 pt-2 pb-4">
        <Composer />
        <p className="mt-2 text-center text-xs text-muted-foreground">{PRIVACY_NOTICE}</p>
      </div>
    </ThreadPrimitive.Root>
  );
};
