'use client';

import { CalendarOff, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, unwrap } from '@/lib/api';
import {
  dateKey,
  formatDay,
  minutesToTime,
  timeToMinutes,
  WEEKDAYS,
  type AvailabilityConfig,
  type AvailabilityException,
} from '@/lib/calendar';
import { ErrorAlert } from '../error-alert';

type Window = { start: string; end: string };
type Draft = Record<number, Window[]>;

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : 'No se pudo completar la acción');

const toDraft = (rules: AvailabilityConfig['rules']): Draft => {
  const draft: Draft = {};
  for (const { weekday } of WEEKDAYS) draft[weekday] = [];
  for (const rule of rules) draft[rule.weekday]!.push({ start: minutesToTime(rule.startMinute), end: minutesToTime(rule.endMinute) });
  return draft;
};

/** Convierte el borrador en el cuerpo de la API; devuelve el motivo si alguna ventana es inválida. */
function toRules(draft: Draft): { rules: { weekday: number; startMinute: number; endMinute: number }[] } | { error: string } {
  const rules: { weekday: number; startMinute: number; endMinute: number }[] = [];
  for (const { weekday, label } of WEEKDAYS) {
    const windows: { startMinute: number; endMinute: number }[] = [];
    for (const window of draft[weekday] ?? []) {
      const startMinute = timeToMinutes(window.start);
      const endMinute = timeToMinutes(window.end);
      if (startMinute === null || endMinute === null) return { error: `${label}: completa la hora de inicio y de término` };
      if (startMinute >= endMinute) return { error: `${label}: la hora de inicio debe ser anterior a la de término` };
      windows.push({ startMinute, endMinute });
    }
    windows.sort((a, b) => a.startMinute - b.startMinute);
    if (windows.some((window, index) => index > 0 && window.startMinute < windows[index - 1]!.endMinute)) {
      return { error: `${label}: los horarios del mismo día no pueden solaparse` };
    }
    rules.push(...windows.map((window) => ({ weekday, ...window })));
  }
  return { rules };
}

function WeeklyHours({ config, onSaved }: { config: AvailabilityConfig; onSaved: (config: AvailabilityConfig) => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(config.rules));
  const [saving, setSaving] = useState(false);

  const update = (weekday: number, windows: Window[]) => setDraft((previous) => ({ ...previous, [weekday]: windows }));

  async function save() {
    const parsed = toRules(draft);
    if ('error' in parsed) {
      toast.error(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const saved = await unwrap<AvailabilityConfig>(await api.api.admin.calendar.availability.rules.$put({ json: { rules: parsed.rules } }));
      onSaved(saved);
      setDraft(toDraft(saved.rules));
      toast.success('Horario semanal guardado');
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Horario semanal">
      <div>
        <h3 className="text-sm font-semibold">Horario semanal</h3>
        <p className="text-xs text-muted-foreground">
          Las horas en que se puede reservar, en la hora de Fab Lab. Cada reunión dura {config.durationMinutes} minutos y los bloques parten
          desde la hora de inicio. Un día sin horarios no se atiende.
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-xl border">
        {WEEKDAYS.map(({ weekday, label }) => {
          const windows = draft[weekday] ?? [];
          return (
            <li key={weekday} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
              <span className="w-24 pt-1.5 text-sm font-medium">{label}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {windows.length === 0 && <span className="pt-1.5 text-sm text-muted-foreground">Sin atención</span>}
                {windows.map((window, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="time"
                      step={900}
                      value={window.start}
                      onChange={(event) => update(weekday, windows.map((item, i) => (i === index ? { ...item, start: event.target.value } : item)))}
                      aria-label={`${label}: desde`}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">a</span>
                    <Input
                      type="time"
                      step={900}
                      value={window.end}
                      onChange={(event) => update(weekday, windows.map((item, i) => (i === index ? { ...item, end: event.target.value } : item)))}
                      aria-label={`${label}: hasta`}
                      className="w-32"
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => update(weekday, windows.filter((_, i) => i !== index))}
                      aria-label={`${label}: quitar horario`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => update(weekday, [...windows, windows.length === 0 ? { start: '08:00', end: '20:00' } : { start: '', end: '' }])}
              >
                <Plus aria-hidden /> Agregar horario
              </Button>
            </li>
          );
        })}
      </ul>
      <Button type="button" onClick={() => void save()} disabled={saving} className="w-fit self-end">
        <Save aria-hidden /> Guardar horario semanal
      </Button>
    </section>
  );
}

const KIND_LABELS = { closed: 'Cerrado', open: 'Abierto' } as const;

function describeException(exception: AvailabilityException): string {
  const { kind, startMinute, endMinute } = exception;
  if (startMinute === null || endMinute === null) return `${KIND_LABELS[kind]} todo el día`;
  return `${KIND_LABELS[kind]} de ${minutesToTime(startMinute)} a ${minutesToTime(endMinute)}`;
}

function Exceptions({ config, onChange }: { config: AvailabilityConfig; onChange: (exceptions: AvailabilityException[]) => void }) {
  const [kind, setKind] = useState<'closed' | 'open'>('closed');
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // `currentTarget` es null después de un `await`: se guarda el formulario antes.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const start = String(form.get('start') ?? '');
    const end = String(form.get('end') ?? '');
    const startMinute = start ? timeToMinutes(start) : null;
    const endMinute = end ? timeToMinutes(end) : null;
    if (kind === 'open' && (startMinute === null || endMinute === null)) {
      toast.error('Para abrir un día indica la hora de inicio y la de término');
      return;
    }
    if ((startMinute === null) !== (endMinute === null)) {
      toast.error('Indica la hora de inicio y la de término, o ninguna');
      return;
    }
    setBusy(true);
    try {
      const { exception } = await unwrap<{ exception: AvailabilityException }>(
        await api.api.admin.calendar.availability.exceptions.$post({
          json: { date: String(form.get('date') ?? ''), kind, startMinute, endMinute, note: String(form.get('note') ?? '').trim() || null },
        }),
      );
      onChange([...config.exceptions, exception].sort((a, b) => a.date.localeCompare(b.date) || (a.startMinute ?? 0) - (b.startMinute ?? 0)));
      formElement.reset();
      toast.success('Excepción agregada');
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(exception: AvailabilityException) {
    try {
      const response = await api.api.admin.calendar.availability.exceptions[':id'].$delete({ param: { id: exception.id } });
      if (!response.ok) await unwrap(response);
      onChange(config.exceptions.filter((item) => item.id !== exception.id));
      toast.success('Excepción eliminada');
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Excepciones por fecha">
      <div>
        <h3 className="text-sm font-semibold">Excepciones por fecha</h3>
        <p className="text-xs text-muted-foreground">
          Feriados, vacaciones o días con otro horario. Un cierre sin horas cierra el día entero y siempre gana sobre una apertura.
        </p>
      </div>

      {config.exceptions.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarOff className="size-4" aria-hidden /> No hay excepciones próximas.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border" aria-label="Excepciones próximas">
          {config.exceptions.map((exception) => (
            <li key={exception.id} className="flex items-center gap-3 p-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium capitalize">{formatDay(exception.date)}</span>
                <span className="block text-muted-foreground">
                  {describeException(exception)}
                  {exception.note ? ` · ${exception.note}` : ''}
                </span>
              </span>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => void remove(exception)} aria-label={`Eliminar excepción del ${formatDay(exception.date)}`}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2" aria-label="Agregar excepción">
        <div className="flex flex-col gap-2">
          <Label htmlFor="exc-date">Fecha</Label>
          <Input id="exc-date" name="date" type="date" required min={dateKey(new Date())} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="exc-kind">Tipo</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as 'closed' | 'open')}>
            <SelectTrigger id="exc-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="closed">Cerrado (todo el día o un tramo)</SelectItem>
              <SelectItem value="open">Abierto en un tramo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="exc-start">Desde {kind === 'closed' && <span className="font-normal text-muted-foreground">(opcional)</span>}</Label>
          <Input id="exc-start" name="start" type="time" step={900} required={kind === 'open'} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="exc-end">Hasta {kind === 'closed' && <span className="font-normal text-muted-foreground">(opcional)</span>}</Label>
          <Input id="exc-end" name="end" type="time" step={900} required={kind === 'open'} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="exc-note">Nota (opcional)</Label>
          <Input id="exc-note" name="note" maxLength={200} placeholder="Ej.: Feriado, capacitación del equipo" />
        </div>
        <Button type="submit" variant="secondary" disabled={busy} className="w-fit sm:col-span-2">
          <Plus aria-hidden /> Agregar excepción
        </Button>
      </form>
    </section>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El horario cambió: el calendario debe volver a sombrear lo que no se atiende. */
  onChanged: () => void;
};

/** Disponibilidad (4.1): horario semanal base y excepciones por fecha, editables por el equipo. */
export function AvailabilityEditor({ open, onOpenChange, onChanged }: Props) {
  const [config, setConfig] = useState<AvailabilityConfig | null>(null);
  // Cada carga reinicia el borrador del horario semanal con lo que hay guardado.
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    api.api.admin.calendar.availability
      .$get()
      .then((response) => unwrap<AvailabilityConfig>(response))
      .then((data) => {
        if (ignore) return;
        setConfig(data);
        setLoadedVersion((version) => version + 1);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!ignore) setError(messageOf(cause));
      });
    return () => {
      ignore = true;
    };
  }, [open, retry]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Disponibilidad para reuniones</DialogTitle>
          <DialogDescription>Define cuándo el asistente puede ofrecer y agendar reuniones presenciales.</DialogDescription>
        </DialogHeader>

        {error && <ErrorAlert message={error} onRetry={() => setRetry((n) => n + 1)} />}
        {!config && !error && (
          <div className="flex flex-col gap-3" role="status" aria-label="Cargando la disponibilidad">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {config && (
          <div className="flex flex-col gap-8">
            <WeeklyHours
              key={loadedVersion}
              config={config}
              onSaved={(saved) => {
                setConfig((previous) => (previous ? { ...previous, rules: saved.rules } : saved));
                onChanged();
              }}
            />
            <Exceptions
              config={config}
              onChange={(exceptions) => {
                setConfig({ ...config, exceptions });
                onChanged();
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
