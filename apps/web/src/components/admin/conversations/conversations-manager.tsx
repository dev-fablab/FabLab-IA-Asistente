'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Eraser, MessageSquareDashed, MessagesSquare, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, unwrap } from '@/lib/api';
import {
  apiQueryFromQuery,
  formatDateTime,
  hasActiveFilters,
  queryFromSearchParams,
  searchParamsFromQuery,
  type ConversationQuery,
  type ConversationRow,
} from '@/lib/conversations';
import { EmptyState } from '../empty-state';
import { ErrorAlert } from '../error-alert';
import { PageHeader } from '../page-header';
import { NoAnswerBadge } from './no-answer-badge';

type ListResult = { items: ConversationRow[]; page: number; total: number; totalPages: number };

/** Estado de la última consulta; `key` dice a qué filtros corresponde y así se sabe si hay una en curso. */
type Loaded = { key: string; data?: ListResult; error?: string };

/**
 * Historial de conversaciones (RF-19, RF-21, RF-22): lista paginada de solo lectura con filtros por
 * «sin información», fechas y texto. Los filtros viven en la URL: se pueden compartir y la vuelta
 * desde el detalle conserva el estado.
 */
export function ConversationsManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = queryFromSearchParams(new URLSearchParams(searchParams.toString()));
  const key = searchParamsFromQuery(query).toString();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [retry, setRetry] = useState(0);
  // La caja de texto se aplica al enviar, no en cada tecla.
  const [text, setText] = useState(query.q);

  useEffect(() => {
    let ignore = false;
    api.api.admin.conversations
      .$get({ query: apiQueryFromQuery(queryFromSearchParams(new URLSearchParams(key))) })
      .then((response) => unwrap<ListResult>(response))
      .then((data) => {
        if (!ignore) setLoaded({ key, data });
      })
      .catch((cause: unknown) => {
        if (!ignore) setLoaded({ key, error: cause instanceof Error ? cause.message : 'No se pudo cargar el historial' });
      });
    return () => {
      ignore = true;
    };
  }, [key, retry]);

  const loading = loaded?.key !== key;
  const data = loaded?.key === key ? loaded.data : undefined;
  const error = loaded?.key === key ? loaded.error : undefined;

  function update(changes: Partial<ConversationQuery>) {
    // Cambiar un filtro vuelve a la primera página.
    const next: ConversationQuery = { ...query, page: 1, ...changes };
    const qs = searchParamsFromQuery(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    update({ q: text });
  }

  function clearFilters() {
    setText('');
    router.replace(pathname);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        icon={MessagesSquare}
        title="Historial"
        description="Todas las conversaciones del chat. Las marcadas «Sin información» muestran qué falta documentar."
      />

      <form onSubmit={submitSearch} className="flex flex-wrap items-end gap-4 rounded-xl border bg-card p-4 shadow-xs" aria-label="Filtros del historial">
        <div className="flex min-w-60 flex-1 flex-col gap-2">
          <Label htmlFor="conv-q">Buscar en las conversaciones</Label>
          <div className="flex gap-2">
            <Input id="conv-q" type="search" value={text} onChange={(event) => setText(event.target.value)} maxLength={200} placeholder="Texto de una pregunta o respuesta" />
            <Button type="submit" variant="secondary" aria-label="Buscar">
              <Search aria-hidden /> Buscar
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="conv-from">
            <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden /> Desde
          </Label>
          <Input id="conv-from" type="date" value={query.from} max={query.to || undefined} onChange={(event) => update({ from: event.target.value })} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="conv-to">
            <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden /> Hasta
          </Label>
          <Input id="conv-to" type="date" value={query.to} min={query.from || undefined} onChange={(event) => update({ to: event.target.value })} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="conv-no-answer" checked={query.noAnswer} onCheckedChange={(checked) => update({ noAnswer: checked })} />
          <Label htmlFor="conv-no-answer">Solo «sin información»</Label>
        </div>
        {hasActiveFilters(query) && (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            <Eraser aria-hidden /> Limpiar filtros
          </Button>
        )}
      </form>

      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Cargando conversaciones">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {error && <ErrorAlert message={error} onRetry={() => setRetry((n) => n + 1)} />}

      {data && data.items.length === 0 && (
        <EmptyState icon={MessageSquareDashed}>
          {hasActiveFilters(query) ? 'No hay conversaciones con estos filtros.' : 'Aún no hay conversaciones. Aparecerán aquí cuando alguien use el chat.'}
        </EmptyState>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Primera pregunta</TableHead>
                  <TableHead className="text-right">Mensajes</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((conversation) => (
                  <TableRow key={conversation.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(conversation.lastMessageAt)}</TableCell>
                    <TableCell className="max-w-xl">
                      <Link href={`/admin/conversations/${conversation.id}`} className="block truncate font-medium underline-offset-4 hover:underline" title={conversation.firstMessage ?? undefined}>
                        {conversation.firstMessage ?? '(sin texto)'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{conversation.messageCount}</TableCell>
                    <TableCell>{conversation.hasNoAnswer && <NoAnswerBadge />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <nav className="flex items-center justify-between gap-4 text-sm" aria-label="Paginación">
            <span className="text-muted-foreground">
              Página {data.page} de {data.totalPages} · {data.total} {data.total === 1 ? 'conversación' : 'conversaciones'}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => update({ page: data.page - 1 })}>
                <ChevronLeft aria-hidden /> Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => update({ page: data.page + 1 })}>
                Siguiente <ChevronRight aria-hidden />
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
