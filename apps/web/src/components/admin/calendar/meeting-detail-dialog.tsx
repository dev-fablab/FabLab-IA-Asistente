'use client';

import { CalendarClock, Check, ExternalLink, MessageSquareText, Pencil, Plus, Trash2, UserCheck, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, unwrap } from '@/lib/api';
import {
  dateKey,
  formatClock,
  formatMeetingRange,
  memberName,
  ROLE_LABELS,
  STATUS_LABELS,
  zonedInstant,
  type MeetingDetail,
  type MeetingMinute,
  type MeetingStatus,
  type TeamMember,
} from '@/lib/calendar';
import { contactHref } from '@/lib/chat/links';
import { isChannelType, TYPE_LABELS } from '@/lib/contact';
import { CHANNEL_ICONS } from '../contact/channel-type';
import { ErrorAlert } from '../error-alert';
import { SourceBadge } from './source-badge';

type State = { id: string; detail?: MeetingDetail; error?: string };

type Props = {
  /** `null` cierra el modal. */
  meetingId: string | null;
  onClose: () => void;
  /** La reunión cambió de estado: el calendario debe volver a consultarse. */
  onChanged: () => void;
};

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : 'No se pudo completar la acción');

const STATUS_BADGE: Record<MeetingStatus, 'default' | 'success' | 'secondary'> = {
  scheduled: 'default',
  completed: 'success',
  cancelled: 'secondary',
};

/** Un punto del acta, con edición en el lugar. El equipo puede corregir también lo que escribió el agente. */
function MinuteItem({ minute, onSave, onDelete }: { minute: MeetingMinute; onSave: (content: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(minute.content);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setEditing(false);
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) void run(() => onSave(draft.trim()));
          }}
        >
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} aria-label="Punto del acta" autoFocus />
          <Button type="submit" size="icon-sm" variant="secondary" disabled={busy || !draft.trim()} aria-label="Guardar punto">
            <Check aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              setDraft(minute.content);
              setEditing(false);
            }}
            aria-label="Cancelar edición"
          >
            <X aria-hidden />
          </Button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 wrap-break-word">{minute.content}</span>
          <Badge variant={minute.source === 'agent' ? 'secondary' : 'outline'} className="shrink-0">
            {minute.source === 'agent' ? 'Agente' : 'Equipo'}
          </Badge>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Editar punto: ${minute.content}`}>
            <Pencil aria-hidden />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" disabled={busy} onClick={() => void run(onDelete)} aria-label={`Eliminar punto: ${minute.content}`}>
            <Trash2 aria-hidden />
          </Button>
        </>
      )}
    </li>
  );
}

/**
 * Detalle de una reunión reservada (4.2): quién la pidió, el resumen de la conversación que originó la
 * reserva y el acta, que el agente prellena y el equipo edita.
 */
export function MeetingDetailDialog({ meetingId, onClose, onChanged }: Props) {
  const [state, setState] = useState<State | null>(null);
  const [retry, setRetry] = useState(0);
  const [newPoint, setNewPoint] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    if (!meetingId) return;
    let ignore = false;
    api.api.admin.calendar.meetings[':id']
      .$get({ param: { id: meetingId } })
      .then((response) => unwrap<MeetingDetail>(response))
      .then((detail) => {
        if (!ignore) setState({ id: meetingId, detail });
      })
      .catch((cause: unknown) => {
        if (!ignore) setState({ id: meetingId, error: messageOf(cause) });
      });
    return () => {
      ignore = true;
    };
  }, [meetingId, retry]);

  // Quién puede ser responsable (todo el equipo, staff y admin) y quién soy yo, para «Asignarme a mí».
  const needsTeam = meetingId !== null && team === null;
  useEffect(() => {
    if (!needsTeam) return;
    let ignore = false;
    Promise.all([
      api.api.admin.team.$get().then((response) => unwrap<{ members: TeamMember[] }>(response)),
      api.api.admin.me.$get().then((response) => unwrap<{ id: string }>(response)),
    ])
      .then(([{ members }, me]) => {
        if (ignore) return;
        setTeam(members);
        setMyId(me.id);
      })
      .catch(() => {
        // Sin la lista el selector queda deshabilitado; el resto del detalle sigue funcionando.
      });
    return () => {
      ignore = true;
    };
  }, [needsTeam]);

  const current = meetingId && state?.id === meetingId ? state : null;
  const detail = current?.detail;
  const meeting = detail?.meeting;

  function setDetail(next: (detail: MeetingDetail) => MeetingDetail) {
    setState((previous) => (previous?.detail ? { ...previous, detail: next(previous.detail) } : previous));
  }

  async function changeStatus(status: MeetingStatus) {
    if (!meetingId) return;
    setBusy(true);
    try {
      const updated = await unwrap<MeetingDetail>(await api.api.admin.calendar.meetings[':id'].$patch({ param: { id: meetingId }, json: { status } }));
      setState({ id: meetingId, detail: updated });
      toast.success(status === 'cancelled' ? 'Reunión cancelada' : status === 'completed' ? 'Reunión marcada como realizada' : 'Reunión reactivada');
      onChanged();
      if (status === 'cancelled') onClose();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  /** Cambia al responsable (o lo quita con `null`) y deja el detalle con lo que respondió el servidor. */
  async function assign(responsibleId: string | null) {
    if (!meetingId) return;
    setBusy(true);
    try {
      const updated = await unwrap<MeetingDetail>(await api.api.admin.calendar.meetings[':id'].$patch({ param: { id: meetingId }, json: { responsibleId } }));
      setState({ id: meetingId, detail: updated });
      toast.success(updated.responsible ? `Responsable: ${updated.responsible.name}` : 'La reunión quedó sin responsable');
      onChanged();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!meetingId) return;
    const form = new FormData(event.currentTarget);
    const date = String(form.get('date') ?? '');
    const time = String(form.get('time') ?? '');
    if (!date || !time) {
      toast.error('Indica la fecha y la hora nuevas');
      return;
    }
    setBusy(true);
    try {
      const updated = await unwrap<MeetingDetail>(
        await api.api.admin.calendar.meetings[':id'].$patch({ param: { id: meetingId }, json: { startsAt: zonedInstant(date, time).toISOString() } }),
      );
      setState({ id: meetingId, detail: updated });
      toast.success('Reunión reagendada', { description: 'La persona no recibe un aviso automático.' });
      onChanged();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function addPoint(event: FormEvent) {
    event.preventDefault();
    const content = newPoint.trim();
    if (!meetingId || !content) return;
    try {
      const { minute } = await unwrap<{ minute: MeetingMinute }>(
        await api.api.admin.calendar.meetings[':id'].minutes.$post({ param: { id: meetingId }, json: { content } }),
      );
      setDetail((previous) => ({ ...previous, minutes: [...previous.minutes, minute] }));
      setNewPoint('');
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  }

  async function savePoint(id: string, content: string) {
    const { minute } = await unwrap<{ minute: MeetingMinute }>(await api.api.admin.calendar.minutes[':id'].$patch({ param: { id }, json: { content } }));
    setDetail((previous) => ({ ...previous, minutes: previous.minutes.map((item) => (item.id === id ? minute : item)) }));
  }

  async function deletePoint(id: string) {
    const response = await api.api.admin.calendar.minutes[':id'].$delete({ param: { id } });
    if (!response.ok) await unwrap(response);
    setDetail((previous) => ({ ...previous, minutes: previous.minutes.filter((item) => item.id !== id) }));
  }

  return (
    <>
      <Dialog open={meetingId !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{meeting ? `Reunión con ${meeting.contact.name}` : 'Detalle de la reunión'}</DialogTitle>
            <DialogDescription>{meeting ? formatMeetingRange(meeting.startsAt, meeting.endsAt) : 'Cargando…'}</DialogDescription>
          </DialogHeader>

          {!current && (
            <div className="flex flex-col gap-3" role="status" aria-label="Cargando la reunión">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {current?.error && <ErrorAlert message={current.error} onRetry={() => setRetry((n) => n + 1)} />}

          {meeting && detail && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_BADGE[meeting.status]}>{STATUS_LABELS[meeting.status]}</Badge>
                <span className="text-xs text-muted-foreground">Presencial en Fab Lab</span>
              </div>

              <section className="flex flex-col gap-2" aria-label="Persona">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <UserRound className="size-4 text-muted-foreground" aria-hidden /> Persona
                </h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Nombre</dt>
                  <dd className="font-medium">{meeting.contact.name}</dd>
                  <dt className="text-muted-foreground">Correo</dt>
                  <dd>
                    <a href={`mailto:${meeting.contact.email}`} className="underline underline-offset-4">
                      {meeting.contact.email}
                    </a>
                  </dd>
                  <dt className="text-muted-foreground">Medio</dt>
                  <dd>
                    <SourceBadge source={meeting.contact.source} />
                  </dd>
                  {meeting.contact.methods.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">Otros medios</dt>
                      <dd>
                        <ul className="flex flex-col gap-1" aria-label="Otros medios de contacto">
                          {meeting.contact.methods.map((method) => {
                            const Icon = isChannelType(method.type) ? CHANNEL_ICONS[method.type] : UserRound;
                            const href = contactHref(method.type, method.value);
                            return (
                              <li key={method.id} className="flex items-center gap-1.5">
                                <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                                <span className="text-xs text-muted-foreground">{isChannelType(method.type) ? TYPE_LABELS[method.type] : method.type}</span>
                                {href ? (
                                  <a href={href} {...(href.startsWith('http') && { target: '_blank', rel: 'noopener noreferrer' })} className="underline underline-offset-4">
                                    {method.value}
                                  </a>
                                ) : (
                                  <span>{method.value}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Motivo</dt>
                  <dd className="wrap-break-word">{meeting.reason}</dd>
                </dl>
              </section>

              <section className="flex flex-col gap-2" aria-label="Responsable">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <UserCheck className="size-4 text-muted-foreground" aria-hidden /> Responsable de la reunión
                </h3>
                <p className="text-xs text-muted-foreground">La persona del equipo que la lleva a cabo. Se puede cambiar cuando haga falta.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={detail.responsible?.id ?? 'none'} onValueChange={(value) => void assign(value === 'none' ? null : value)} disabled={busy || team === null}>
                    <SelectTrigger aria-label="Responsable de la reunión" className="w-full sm:w-72">
                      <SelectValue placeholder="Cargando el equipo…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin responsable</SelectItem>
                      {(team ?? []).map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {memberName(member)} · {ROLE_LABELS[member.role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {myId && detail.responsible?.id !== myId && (
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void assign(myId)}>
                      Asignarme a mí
                    </Button>
                  )}
                </div>
                {!detail.responsible && <Badge variant="warning" className="w-fit">Sin responsable</Badge>}
              </section>

              <section className="flex flex-col gap-2" aria-label="Resumen de la conversación">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquareText className="size-4 text-muted-foreground" aria-hidden /> Resumen de la conversación
                </h3>
                {meeting.conversationSummary ? (
                  <p className="rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">{meeting.conversationSummary}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">El asistente no dejó un resumen de esta reserva.</p>
                )}
                {meeting.conversationId && (
                  <Link
                    href={`/admin/conversations/${meeting.conversationId}`}
                    className="inline-flex w-fit items-center gap-1.5 text-sm underline underline-offset-4"
                  >
                    Ver la conversación completa <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                )}
              </section>

              <section className="flex flex-col gap-2" aria-label="Acta de la reunión">
                <h3 className="text-sm font-semibold">Acta de la reunión</h3>
                <p className="text-xs text-muted-foreground">
                  Los puntos importantes de lo conversado. El asistente deja los de la conversación; el equipo agrega y corrige el resto.
                </p>
                {detail.minutes.length > 0 ? (
                  <ul className="flex flex-col gap-2" aria-label="Puntos del acta">
                    {detail.minutes.map((minute) => (
                      <MinuteItem key={minute.id} minute={minute} onSave={(content) => savePoint(minute.id, content)} onDelete={() => deletePoint(minute.id)} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Todavía no hay puntos en el acta.</p>
                )}
                <form onSubmit={addPoint} className="flex items-center gap-2">
                  <Input
                    value={newPoint}
                    onChange={(event) => setNewPoint(event.target.value)}
                    maxLength={500}
                    placeholder="Ej.: Se requiere el visto bueno del departamento"
                    aria-label="Nuevo punto del acta"
                  />
                  <Button type="submit" variant="secondary" disabled={!newPoint.trim()}>
                    <Plus aria-hidden /> Agregar
                  </Button>
                </form>
              </section>

              {meeting.status === 'scheduled' && (
                <section className="flex flex-col gap-2" aria-label="Reagendar">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <CalendarClock className="size-4 text-muted-foreground" aria-hidden /> Reagendar
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Dentro del horario de atención y sin chocar con otra reunión. También puedes arrastrarla en el calendario. La persona no recibe un aviso automático.
                  </p>
                  {/* La clave reinicia los campos con el horario nuevo después de mover la reunión. */}
                  <form key={meeting.startsAt} onSubmit={reschedule} className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="resched-date">Fecha</Label>
                      <Input id="resched-date" name="date" type="date" required min={dateKey(new Date())} defaultValue={dateKey(new Date(meeting.startsAt))} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="resched-time">Hora de inicio</Label>
                      <Input id="resched-time" name="time" type="time" step={900} required defaultValue={formatClock(meeting.startsAt)} className="w-32" />
                    </div>
                    <Button type="submit" variant="secondary" disabled={busy}>
                      Reagendar
                    </Button>
                  </form>
                </section>
              )}

              <DialogFooter className="sm:justify-between">
                {meeting.status === 'scheduled' ? (
                  <Button type="button" variant="outline" className="text-destructive" disabled={busy} onClick={() => setConfirmCancel(true)}>
                    Cancelar reunión
                  </Button>
                ) : (
                  <span />
                )}
                {meeting.status === 'scheduled' ? (
                  <Button type="button" disabled={busy} onClick={() => void changeStatus('completed')}>
                    Marcar como realizada
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled={busy} onClick={() => void changeStatus('scheduled')}>
                    Reabrir como agendada
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta reunión?</AlertDialogTitle>
            <AlertDialogDescription>El horario queda libre para que otra persona lo reserve. La persona no recibe un aviso automático.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => void changeStatus('cancelled')}>Cancelar reunión</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
