'use client';

import { es } from 'date-fns/locale';
import { CalendarClock, Plus, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { EventCalendar } from '@/components/reui/event-calendar/event-calendar';
import { EventCalendarContent } from '@/components/reui/event-calendar/event-calendar-content';
import type { EventCalendarI18nOverrides } from '@/components/reui/event-calendar/event-calendar-i18n';
import { EventCalendarNav, EventCalendarToolbar } from '@/components/reui/event-calendar/event-calendar-nav';
import type { CalendarView, EventCalendarInteractions } from '@/components/reui/event-calendar/event-calendar-types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, unwrap } from '@/lib/api';
import { CALENDAR_TIME_ZONE, dateKey, toCalendarEvent, type MeetingRow, type OpenHoursDay } from '@/lib/calendar';
import { ErrorAlert } from '../error-alert';
import { PageHeader } from '../page-header';
import { AvailabilityEditor } from './availability-editor';
import { MeetingDetailDialog } from './meeting-detail-dialog';
import { ManualMeetingDialog } from './manual-meeting-dialog';
import { useMeetingMover } from './use-meeting-mover';

// Constantes de módulo: el calendario compara estas props por identidad en cada render.
const VIEWS: CalendarView[] = ['week', 'day', 'month', 'agenda'];
// Las reuniones no se crean seleccionando un tramo vacío; se agendan desde el botón del encabezado. Desde el
// calendario solo se arrastran para reagendarlas y no se redimensionan.
const INTERACTIONS: Partial<EventCalendarInteractions> = { drag: true, resize: false, selectSlot: false };

const I18N: EventCalendarI18nOverrides = {
  labels: {
    today: 'Hoy',
    previous: 'Anterior',
    next: 'Siguiente',
    addEvent: 'Agregar',
    allDay: 'Todo el día',
    more: (count) => `+${count} más`,
    noEvents: 'No hay reuniones agendadas',
    loading: 'Cargando reuniones',
    event: 'reunión',
    events: (count) => (count === 1 ? '1 reunión' : `${count} reuniones`),
    selectView: 'Cambiar vista',
    week: (weekNumber) => `S${weekNumber}`,
    goToDate: 'Ir a la fecha',
    continues: 'continúa',
    timeFrom: (time) => `Desde ${time}`,
    timeUntil: (time) => `Hasta ${time}`,
    toggleDayEvents: (count) => (count === 1 ? '1 reunión' : `${count} reuniones`),
    moreCompact: (count) => `+${count}`,
    timeRange: (from, to) => `${from} a ${to}`,
  },
  viewNames: { month: 'Mes', week: 'Semana', day: 'Día', days: (count) => `${count} días`, agenda: 'Agenda' },
  formats: {
    monthTitle: "MMMM 'de' yyyy",
    dayTitle: "EEEE d 'de' MMMM 'de' yyyy",
    agendaDayHeader: "EEEE d 'de' MMMM",
    moreDayHeader: "EEEE d 'de' MMMM",
    timeGutter: 'HH:mm',
    timeGutterMinute: 'HH:mm',
    eventTime: 'HH:mm',
  },
};

type Loaded = { key: string; meetings: MeetingRow[]; openHours: Map<string, OpenHoursDay['open']>; error?: string };

/** Los tramos de una columna de `[desde, hasta)` minutos que quedan fuera de las ventanas de atención. */
function closedSpans(windows: OpenHoursDay['open'], from: number, to: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let cursor = from;
  for (const window of windows) {
    if (window.startMinute > cursor) spans.push([cursor, Math.min(window.startMinute, to)]);
    cursor = Math.max(cursor, window.endMinute);
  }
  if (cursor < to) spans.push([cursor, to]);
  return spans.filter(([start, end]) => end > start);
}

const subscribeNever = () => () => {};

/**
 * Calendario de reuniones (sección 4). El calendario de ReUI no guarda nada: se usa controlado, con las
 * reuniones del rango visible que entrega la API, y al hacer clic en una se abre su detalle.
 */
export function CalendarManager() {
  // El calendario lee la hora del navegador: se monta solo en el cliente para no desajustar la hidratación.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingAvailability, setEditingAvailability] = useState(false);
  const [creatingMeeting, setCreatingMeeting] = useState(false);

  const key = range ? `${range.start.toISOString()}|${range.end.toISOString()}` : null;

  useEffect(() => {
    if (!range || !key) return;
    let ignore = false;
    const from = range.start.toISOString();
    const to = range.end.toISOString();

    Promise.all([
      api.api.admin.calendar.meetings.$get({ query: { from, to } }).then((response) => unwrap<{ items: MeetingRow[] }>(response)),
      api.api.admin.calendar.availability['open-hours']
        .$get({ query: { from: dateKey(range.start), to: dateKey(new Date(range.end.getTime() - 1)) } })
        .then((response) => unwrap<{ days: OpenHoursDay[] }>(response)),
    ])
      .then(([{ items }, { days }]) => {
        if (!ignore) setLoaded({ key, meetings: items, openHours: new Map(days.map((day) => [day.date, day.open])) });
      })
      .catch((cause: unknown) => {
        if (!ignore) {
          setLoaded((previous) => ({
            key,
            meetings: previous?.meetings ?? [],
            openHours: previous?.openHours ?? new Map(),
            error: cause instanceof Error ? cause.message : 'No se pudo cargar el calendario',
          }));
        }
      });
    return () => {
      ignore = true;
    };
    // `reload` vuelve a consultar el mismo rango tras un cambio (estado de una reunión, disponibilidad).
  }, [key, range, reload]);

  const meetings = loaded?.meetings;
  const events = useMemo(() => (meetings ?? []).map(toCalendarEvent), [meetings]);
  const openHours = loaded?.openHours;
  const loading = key === null || loaded?.key !== key;
  const error = loaded?.key === key ? loaded.error : undefined;

  const refresh = () => setReload((n) => n + 1);

  const patchLocal = (id: string, startsAt: string, endsAt: string) =>
    setLoaded((previous) =>
      previous && { ...previous, meetings: previous.meetings.map((meeting) => (meeting.id === id ? { ...meeting, startsAt, endsAt } : meeting)) },
    );

  const mover = useMeetingMover({ meetings, openHours, setTimes: patchLocal });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        icon={CalendarClock}
        title="Agenda"
        description="Reuniones presenciales agendadas por el asistente o por el equipo. Haz clic en una para ver sus detalles; arrástrala para reagendarla."
        actions={
          <div className="flex flex-wrap gap-2 pt-1 pr-1">
            <Button size="lg" onClick={() => setCreatingMeeting(true)}>
              <Plus aria-hidden /> Agendar reunión
            </Button>
            <Button variant="outline" onClick={() => setEditingAvailability(true)}>
              <Settings2 aria-hidden /> Disponibilidad
            </Button>
          </div>
        }
      />

      {error && <ErrorAlert message={error} onRetry={refresh} />}

      <p className="-mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-2.5 rounded-full bg-warning" aria-hidden /> Las reuniones en amarillo todavía no tienen responsable.
      </p>

      <div className="rounded-xl border bg-card shadow-xs">
        {mounted ? (
          <EventCalendar<MeetingRow>
            events={events}
            loading={loading}
            defaultView="week"
            views={VIEWS}
            timeZone={CALENDAR_TIME_ZONE}
            locale={es}
            weekStartsOn={1}
            dayStartHour={6}
            dayEndHour={22}
            scrollToHour={8}
            i18n={I18N}
            interactions={INTERACTIONS}
            // Los días sin atención (según el horario base y las excepciones) se marcan en la vista de mes.
            offDays={{ weekendDays: [], isOffDay: (day) => openHours?.get(dateKey(day))?.length === 0 }}
            // Y en las vistas por hora se sombrean las horas en que no se atiende.
            renderDayColumnBackground={({ day, boundsStartMin, boundsEndMin }) => {
              const windows = openHours?.get(dateKey(day));
              if (!windows) return null;
              return closedSpans(windows, boundsStartMin, boundsEndMin).map(([start, end]) => (
                <div
                  key={start}
                  data-slot="closed-hours"
                  className="absolute inset-x-0 bg-muted/60"
                  style={{
                    top: `calc(var(--ec-hour-height) * ${(start - boundsStartMin) / 60})`,
                    height: `calc(var(--ec-hour-height) * ${(end - start) / 60})`,
                  }}
                />
              ));
            }}
            canDropEvent={mover.canDropEvent}
            onEventUpdate={mover.onEventUpdate}
            onDragBlocked={mover.onDragBlocked}
            onRangeChange={(info) => setRange({ start: info.range.start, end: info.range.end })}
            onEventClick={(occurrence, event) => {
              // El detalle reemplaza a la selección que haría el calendario.
              event.preventDefault();
              setSelectedId(String(occurrence.eventId));
            }}
            className="h-[calc(100dvh-16rem)] min-h-[32rem] w-full"
          >
            <div className="flex flex-wrap items-center gap-2 pe-2">
              <EventCalendarNav className="min-w-0 flex-1" />
              <EventCalendarToolbar />
            </div>
            <EventCalendarContent />
          </EventCalendar>
        ) : (
          <Skeleton className="h-[32rem] w-full" role="status" aria-label="Cargando el calendario" />
        )}
      </div>

      <MeetingDetailDialog meetingId={selectedId} onClose={() => setSelectedId(null)} onChanged={refresh} />
      <ManualMeetingDialog open={creatingMeeting} onOpenChange={setCreatingMeeting} onCreated={refresh} />
      <AvailabilityEditor open={editingAvailability} onOpenChange={setEditingAvailability} onChanged={refresh} />
    </div>
  );
}
