'use client';

import { ArrowLeft, Bot, CalendarDays, Globe, MessageSquare, Mic, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiRequestError, unwrap } from '@/lib/api';
import { formatDateTime, formatTime, type ConversationDetail, type ConversationMessage } from '@/lib/conversations';
import { cn } from '@/lib/utils';
import { ErrorAlert } from '../error-alert';
import { NoAnswerBadge } from './no-answer-badge';

type State = { id: string; detail?: ConversationDetail; error?: { message: string; notFound: boolean } };

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';

  return (
    <li className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={cn('flex size-6 items-center justify-center rounded-full', isUser ? 'bg-primary/10 text-primary' : 'bg-foreground text-background')}
          aria-hidden
        >
          {isUser ? <UserRound className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>
        <span className="font-medium">{isUser ? 'Persona' : 'Asistente'}</span>
        <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        {message.noAnswer && <NoAnswerBadge />}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2 text-sm wrap-break-word',
          isUser ? 'bg-primary whitespace-pre-wrap text-primary-foreground' : 'border bg-card shadow-xs',
          message.noAnswer && 'border-warning/50',
        )}
      >
        {isUser ? (
          message.content
        ) : (
          <div className="flex flex-col gap-2 [&_a]:underline [&_li]:ms-4 [&_ol]:list-decimal [&_ul]:list-disc">
            {/* react-markdown no ejecuta HTML ni URL `javascript:`; los enlaces abren en otra pestaña. */}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </li>
  );
}

/** Hilo completo de una conversación, en modo lectura (RF-20). */
export function ConversationDetailView({ id }: { id: string }) {
  const [state, setState] = useState<State | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let ignore = false;
    api.api.admin.conversations[':id']
      .$get({ param: { id } })
      .then((response) => unwrap<ConversationDetail>(response))
      .then((detail) => {
        if (!ignore) setState({ id, detail });
      })
      .catch((cause: unknown) => {
        if (ignore) return;
        const notFound = cause instanceof ApiRequestError && (cause.status === 404 || cause.status === 400);
        setState({ id, error: { message: cause instanceof Error ? cause.message : 'No se pudo cargar la conversación', notFound } });
      });
    return () => {
      ignore = true;
    };
  }, [id, retry]);

  const current = state?.id === id ? state : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/admin/conversations">
          <ArrowLeft aria-hidden /> Volver al historial
        </Link>
      </Button>

      {!current && (
        <div className="flex flex-col gap-3" role="status" aria-label="Cargando la conversación">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="ml-auto h-12 w-2/3" />
        </div>
      )}

      {current?.error && (
        <ErrorAlert
          message={current.error.notFound ? 'No se encontró esta conversación.' : current.error.message}
          onRetry={current.error.notFound ? undefined : () => setRetry((n) => n + 1)}
        />
      )}

      {current?.detail && (
        <>
          <header className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold">Conversación</h1>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" aria-hidden />
                {formatDateTime(current.detail.conversation.createdAt)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare className="size-4" aria-hidden />
                {current.detail.messages.length} mensajes
              </span>
              <span className="inline-flex items-center gap-1.5">
                {current.detail.conversation.channel === 'web' ? <Globe className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
                Canal: {current.detail.conversation.channel === 'web' ? 'chat web' : 'voz'}
              </span>
              {current.detail.conversation.hasNoAnswer && <NoAnswerBadge />}
            </p>
          </header>
          <ol className="flex flex-col gap-4" aria-label="Mensajes de la conversación">
            {current.detail.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
