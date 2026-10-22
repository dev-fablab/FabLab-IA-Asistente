'use client';

import { ChevronDown, ChevronLeft, ChevronRight, Eraser, Pencil, Plus, Search, UserRound, Users } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, unwrap } from '@/lib/api';
import {
  formatMeetingStart,
  isSource,
  SOURCE_LABELS,
  SOURCES,
  STATUS_LABELS,
  type ContactSource,
  type MeetingStatus,
  type PeoplePage,
  type Person,
  type PersonDetail,
  type PersonRow,
} from '@/lib/calendar';
import { isChannelType, TYPE_LABELS } from '@/lib/contact';
import { contactHref } from '@/lib/chat/links';
import { formatDateTime } from '@/lib/conversations';
import { CHANNEL_ICONS } from '../contact/channel-type';
import { EmptyState } from '../empty-state';
import { ErrorAlert } from '../error-alert';
import { PageHeader } from '../page-header';
import { MeetingDetailDialog } from './meeting-detail-dialog';
import { PersonDialog } from './person-dialog';
import { SOURCE_ICONS, SourceBadge } from './source-badge';

type Loaded = { key: string; data?: PeoplePage; error?: string };
type Expanded = { id: string; detail?: PersonDetail; error?: string };

const ALL_SOURCES = 'all';

const STATUS_BADGE: Record<MeetingStatus, 'default' | 'success' | 'secondary'> = {
  scheduled: 'default',
  completed: 'success',
  cancelled: 'secondary',
};

const messageOf = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);

/** Otras formas de ubicar a la persona, con enlace accionable (`tel:`, `mailto:`, wa.me...) cuando el tipo lo permite. */
function PersonMethods({ person }: { person: Person }) {
  if (person.methods.length === 0) return <p className="text-sm text-muted-foreground">Sin otros medios de contacto además del correo.</p>;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-label={`Medios de contacto de ${person.name}`}>
      {person.methods.map((method) => {
        const Icon = isChannelType(method.type) ? CHANNEL_ICONS[method.type] : UserRound;
        const href = contactHref(method.type, method.value);
        return (
          <li key={method.id} className="flex items-center gap-1.5 text-sm">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-xs text-muted-foreground">{isChannelType(method.type) ? TYPE_LABELS[method.type] : method.type}</span>
            {href ? (
              <a href={href} {...(href.startsWith('http') && { target: '_blank', rel: 'noopener noreferrer' })} className="font-medium underline underline-offset-4">
                {method.value}
              </a>
            ) : (
              <span className="font-medium">{method.value}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Lo que se sabe de una persona y sus reuniones, bajo su fila. Cada reunión abre su detalle. */
function PersonExpanded({
  expanded,
  onOpenMeeting,
  onEdit,
  onRetry,
}: {
  expanded: Expanded;
  onOpenMeeting: (meetingId: string) => void;
  onEdit: (person: Person) => void;
  onRetry: () => void;
}) {
  if (expanded.error) return <ErrorAlert message={expanded.error} onRetry={onRetry} />;
  if (!expanded.detail) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Cargando a la persona">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const { person, meetings } = expanded.detail;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <PersonMethods person={person} />
          <p className="text-xs text-muted-foreground">
            Registrada {person.createdByName ? `por ${person.createdByName}` : 'por el asistente, al agendar por el chat'} el {formatDateTime(person.createdAt)}.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(person)}>
          <Pencil aria-hidden /> Editar
        </Button>
      </div>

      {meetings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Esta persona todavía no tiene reuniones.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={`Reuniones de ${person.name}`}>
          {meetings.map((meeting) => (
            <li key={meeting.id}>
              <button
                type="button"
                onClick={() => onOpenMeeting(meeting.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="font-medium tabular-nums">{formatMeetingStart(meeting.startsAt)}</span>
                <Badge variant={STATUS_BADGE[meeting.status]}>{STATUS_LABELS[meeting.status]}</Badge>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={meeting.reason}>
                  {meeting.reason}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserRound className="size-3.5" aria-hidden />
                  {meeting.responsibleName ?? 'Sin responsable'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Personas (sección Calendario): quienes se relacionan con Fab Lab, vengan por el chat o las registre el equipo,
 * con el medio por el que llegaron, cuántas reuniones llevan y cuándo es la próxima. Cada fila se despliega con
 * sus medios de contacto y sus reuniones. La búsqueda, el filtro y la página viven en la URL, como en el historial.
 */
export function PeopleManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const sourceParam = searchParams.get('source') ?? '';
  const source = isSource(sourceParam) ? sourceParam : null;
  const parsedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const key = `${page}|${q}|${source ?? ''}`;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [retry, setRetry] = useState(0);
  const [text, setText] = useState(q);
  const [expanded, setExpanded] = useState<Expanded | null>(null);
  const [reloadDetail, setReloadDetail] = useState(0);
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [editing, setEditing] = useState<Person | 'new' | null>(null);

  useEffect(() => {
    let ignore = false;
    api.api.admin.calendar.people
      .$get({ query: { page: String(page), ...(q.trim() && { q: q.trim() }), ...(source && { source }) } })
      .then((response) => unwrap<PeoplePage>(response))
      .then((data) => {
        if (!ignore) setLoaded({ key, data });
      })
      .catch((cause: unknown) => {
        if (!ignore) setLoaded({ key, error: messageOf(cause, 'No se pudo cargar a las personas') });
      });
    return () => {
      ignore = true;
    };
  }, [key, page, q, source, retry]);

  const expandedId = expanded?.id;
  useEffect(() => {
    if (!expandedId) return;
    let ignore = false;
    api.api.admin.calendar.people[':id']
      .$get({ param: { id: expandedId } })
      .then((response) => unwrap<PersonDetail>(response))
      .then((detail) => {
        if (!ignore) setExpanded({ id: expandedId, detail });
      })
      .catch((cause: unknown) => {
        if (!ignore) setExpanded({ id: expandedId, error: messageOf(cause, 'No se pudo cargar a la persona') });
      });
    return () => {
      ignore = true;
    };
  }, [expandedId, reloadDetail]);

  const loading = loaded?.key !== key;
  const data = loaded?.key === key ? loaded.data : undefined;
  const error = loaded?.key === key ? loaded.error : undefined;
  const filtered = Boolean(q.trim()) || source !== null;

  function go(next: { page?: number; q?: string; source?: ContactSource | null }) {
    const params = new URLSearchParams();
    const nextQ = (next.q ?? q).trim();
    const nextSource = next.source === undefined ? source : next.source;
    const nextPage = next.page ?? 1;
    if (nextQ) params.set('q', nextQ);
    if (nextSource) params.set('source', nextSource);
    if (nextPage > 1) params.set('page', String(nextPage));
    const qs = params.toString();
    setExpanded(null);
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    go({ q: text, page: 1 });
  }

  /** Cambió una reunión o la ficha de una persona: se actualizan las cifras de la lista y lo desplegado. */
  function refresh() {
    setRetry((n) => n + 1);
    setReloadDetail((n) => n + 1);
  }

  function saved(detail: PersonDetail, created: boolean) {
    toast.success(created ? 'Persona agregada' : 'Persona actualizada');
    refresh();
    if (created) {
      // La lista pasa a buscar su correo: así la persona recién agregada se ve aunque hubiera filtros o otra página.
      setText(detail.person.email);
      go({ q: detail.person.email, source: null, page: 1 });
    }
    // Queda abierta su ficha, con lo que quedó registrado.
    setExpanded({ id: detail.person.id, detail });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        icon={Users}
        title="Personas"
        description="Quienes se relacionan con Fab Lab: las que piden una reunión por el chat y las que registra el equipo. Despliega una para ver cómo ubicarla y sus reuniones."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Agregar persona
          </Button>
        }
      />

      <form onSubmit={submitSearch} className="flex flex-wrap items-end gap-4 rounded-xl border bg-card p-4 shadow-xs" aria-label="Buscar personas">
        <div className="flex min-w-60 flex-1 flex-col gap-2">
          <Label htmlFor="people-q">Buscar por nombre o correo</Label>
          <div className="flex gap-2">
            <Input id="people-q" type="search" value={text} onChange={(event) => setText(event.target.value)} maxLength={200} placeholder="Ej.: Camila o camila@correo.cl" />
            <Button type="submit" variant="secondary">
              <Search aria-hidden /> Buscar
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="people-source">Medio</Label>
          <Select value={source ?? ALL_SOURCES} onValueChange={(value) => go({ source: isSource(value) ? value : null, page: 1 })}>
            <SelectTrigger id="people-source" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SOURCES}>Todos los medios</SelectItem>
              {SOURCES.map((option) => {
                const Icon = SOURCE_ICONS[option];
                return (
                  <SelectItem key={option} value={option}>
                    <Icon aria-hidden /> {SOURCE_LABELS[option]}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        {filtered && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setText('');
              go({ q: '', source: null, page: 1 });
            }}
          >
            <Eraser aria-hidden /> Limpiar filtros
          </Button>
        )}
      </form>

      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="Cargando personas">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {error && <ErrorAlert message={error} onRetry={() => setRetry((n) => n + 1)} />}

      {data && data.items.length === 0 && (
        <EmptyState icon={Users}>
          {filtered
            ? 'No hay personas que coincidan con los filtros.'
            : 'Aún no hay personas. Aparecerán aquí cuando alguien agende una reunión con el asistente o cuando las agregues tú.'}
        </EmptyState>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Persona</TableHead>
                  <TableHead>Medio</TableHead>
                  <TableHead className="text-right">Reuniones</TableHead>
                  <TableHead>Próxima reunión</TableHead>
                  <TableHead>Registrada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row: PersonRow) => {
                  const open = expanded?.id === row.id;
                  return (
                    <Fragment key={row.id}>
                      <TableRow data-state={open ? 'selected' : undefined}>
                        <TableCell>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-expanded={open}
                            aria-label={`${open ? 'Ocultar' : 'Ver'} los datos de ${row.name}`}
                            onClick={() => setExpanded((current) => (current?.id === row.id ? null : { id: row.id }))}
                          >
                            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <span className="block font-medium">{row.name}</span>
                          <a href={`mailto:${row.email}`} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                            {row.email}
                          </a>
                        </TableCell>
                        <TableCell>
                          <SourceBadge source={row.source} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.meetingCount}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.nextMeetingAt ? formatMeetingStart(row.nextMeetingAt) : <span className="text-muted-foreground">Sin reuniones por venir</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.createdAt)}</TableCell>
                      </TableRow>
                      {open && expanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={5} className="py-3 whitespace-normal">
                            <PersonExpanded
                              expanded={expanded}
                              onOpenMeeting={setSelectedMeeting}
                              onEdit={setEditing}
                              onRetry={() => setReloadDetail((n) => n + 1)}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <nav className="flex items-center justify-between gap-4 text-sm" aria-label="Paginación">
            <span className="text-muted-foreground">
              Página {data.page} de {data.totalPages} · {data.total} {data.total === 1 ? 'persona' : 'personas'}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => go({ page: data.page - 1 })}>
                <ChevronLeft aria-hidden /> Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => go({ page: data.page + 1 })}>
                Siguiente <ChevronRight aria-hidden />
              </Button>
            </div>
          </nav>
        </>
      )}

      <PersonDialog target={editing} onClose={() => setEditing(null)} onSaved={saved} />
      <MeetingDetailDialog meetingId={selectedMeeting} onClose={() => setSelectedMeeting(null)} onChanged={refresh} />
    </div>
  );
}
