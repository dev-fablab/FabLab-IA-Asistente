import type { ContactSource } from '@fablab/db';
import { TZDate } from '@date-fns/tz';
import type { InferResponseType } from 'hono/client';
import type { CalendarEvent } from '@/components/reui/event-calendar/event-calendar-types';
import type { api } from '@/lib/api';

type Calendar = typeof api.api.admin.calendar;

type MeetingsResponse = InferResponseType<Calendar['meetings']['$get'], 200>;
export type MeetingRow = MeetingsResponse['items'][number];

type DetailResponse = InferResponseType<Calendar['meetings'][':id']['$get'], 200>;
export type MeetingDetail = DetailResponse;
export type MeetingMinute = DetailResponse['minutes'][number];

type AvailabilityResponse = InferResponseType<Calendar['availability']['$get'], 200>;
export type AvailabilityConfig = AvailabilityResponse;
export type AvailabilityRule = AvailabilityResponse['rules'][number];
export type AvailabilityException = AvailabilityResponse['exceptions'][number];

type PeopleResponse = InferResponseType<Calendar['people']['$get'], 200>;
export type PeoplePage = PeopleResponse;
export type PersonRow = PeopleResponse['items'][number];

type PersonDetailResponse = InferResponseType<Calendar['people'][':id']['$get'], 200>;
export type PersonDetail = PersonDetailResponse;
export type Person = PersonDetailResponse['person'];
export type PersonMeeting = PersonDetailResponse['meetings'][number];
export type PersonMethod = Person['methods'][number];

export type { ContactSource };

/** Cómo llegó la persona a Fab Lab la primera vez (la etiqueta «medio»). `chat` es lo que registra el asistente. */
export const SOURCE_LABELS: Record<ContactSource, string> = {
  chat: 'Chat',
  in_person: 'Presencial',
  phone: 'Teléfono',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  social: 'Redes sociales',
  other: 'Otro',
};
export const SOURCES = Object.keys(SOURCE_LABELS) as ContactSource[];
export const isSource = (value: string): value is ContactSource => value in SOURCE_LABELS;

type OpenHoursResponse = InferResponseType<Calendar['availability']['open-hours']['$get'], 200>;
export type OpenHoursDay = OpenHoursResponse['days'][number];

export type MeetingStatus = MeetingRow['status'];

type TeamResponse = InferResponseType<typeof api.api.admin.team.$get, 200>;
/** Persona del equipo (staff o admin): cualquiera puede ser responsable de una reunión. */
export type TeamMember = TeamResponse['members'][number];

export const ROLE_LABELS: Record<TeamMember['role'], string> = { admin: 'Administración', staff: 'Staff' };

/** Nombre para mostrar: el cargado en el perfil o, si no hay, el correo. */
export const memberName = (member: Pick<TeamMember, 'fullName' | 'email'>) => member.fullName?.trim() || member.email;

/** Zona horaria de Fab Lab: el calendario y las horas del panel se muestran en ella, vea lo que vea el navegador. */
export const CALENDAR_TIME_ZONE = 'America/Santiago';

/** Lunes primero; el número es el `weekday` de la API (0 = domingo). */
export const WEEKDAYS = [
  { weekday: 1, label: 'Lunes' },
  { weekday: 2, label: 'Martes' },
  { weekday: 3, label: 'Miércoles' },
  { weekday: 4, label: 'Jueves' },
  { weekday: 5, label: 'Viernes' },
  { weekday: 6, label: 'Sábado' },
  { weekday: 0, label: 'Domingo' },
] as const;

export const STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: 'Agendada',
  completed: 'Realizada',
  cancelled: 'Cancelada',
};

/** Color de cada estado en el calendario (variables del tema, claro y oscuro). Sin responsable llama la atención. */
function colorOf(meeting: MeetingRow): string {
  if (meeting.status !== 'scheduled') return 'var(--muted-foreground)';
  return meeting.responsibleId ? 'var(--primary)' : 'var(--warning)';
}

/** «Ana» para «Ana Pérez» y «ana» para «ana@fablab.cl»: lo justo para que quepa en el bloque. */
export const shortName = (name: string) => name.split('@')[0]!.trim().split(/\s+/)[0]!;

export function toCalendarEvent(meeting: MeetingRow): CalendarEvent<MeetingRow> {
  const scheduled = meeting.status === 'scheduled';
  const responsible = meeting.responsibleName ? shortName(meeting.responsibleName) : null;
  return {
    id: meeting.id,
    title: `${meeting.contactName} · ${responsible ?? 'sin responsable'}`,
    start: new Date(meeting.startsAt),
    end: new Date(meeting.endsAt),
    color: colorOf(meeting),
    // Solo se reagendan (arrastrando) las agendadas, y nunca se cambia la duración.
    readOnly: !scheduled,
    draggable: scheduled,
    resizable: false,
    data: meeting,
  };
}

const dateKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** `YYYY-MM-DD` de un instante en la zona de Fab Lab. */
export const dateKey = (value: Date) => dateKeyFormat.format(value);

const longDate = new Intl.DateTimeFormat('es-CL', { timeZone: CALENDAR_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const clock = new Intl.DateTimeFormat('es-CL', { timeZone: CALENDAR_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** «10:00» para un instante, en la hora de Fab Lab. */
export const formatClock = (value: string | Date) => clock.format(new Date(value));

/** «martes, 20 de octubre de 2026, de 10:00 a 11:00». */
export function formatMeetingRange(startsAt: string | Date, endsAt: string | Date): string {
  const start = new Date(startsAt);
  return `${longDate.format(start)}, de ${clock.format(start)} a ${clock.format(new Date(endsAt))}`;
}

const shortDate = new Intl.DateTimeFormat('es-CL', { timeZone: CALENDAR_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
/** «4 mar 2030, 11:00» en la hora de Fab Lab (reloj de 24 horas, como el resto del panel). */
export const formatMeetingStart = (value: string | Date) => {
  const date = new Date(value);
  return `${shortDate.format(date)}, ${clock.format(date)}`;
};

const dayOnly = new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
/** «lunes 26 de octubre» para una fecha `YYYY-MM-DD` (es una fecha de calendario, sin zona). */
export const formatDay = (date: string) => dayOnly.format(new Date(`${date}T12:00:00Z`));

/** «08:00» ↔ 480. */
export const minutesToTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes <= 1440 ? minutes : null;
}

const minuteFormat = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Minutos desde la medianoche de un instante, en la hora de Fab Lab. */
function minuteOfDay(value: Date): number {
  const [hours = 0, minutes = 0] = minuteFormat.format(value).split(':').map(Number);
  return hours * 60 + minutes;
}

/** El instante de una fecha `YYYY-MM-DD` y una hora `HH:MM` en la hora de Fab Lab. */
export function zonedInstant(date: string, time: string): Date {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const minutes = timeToMinutes(time) ?? 0;
  return new Date(new TZDate(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, CALENDAR_TIME_ZONE).getTime());
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

/**
 * ¿Se puede mover la reunión a este bloque? Es la misma regla que aplica el servidor (que decide), para dar
 * aviso mientras se arrastra: dentro del horario de atención, sin choques y no en el pasado. Si el horario de
 * ese día no está cargado se deja pasar y responde el servidor.
 */
export function canMoveMeeting({
  id,
  start,
  end,
  meetings,
  openHours,
  now = new Date(),
}: {
  id: string;
  start: Date;
  end: Date;
  meetings: readonly MeetingRow[];
  openHours: ReadonlyMap<string, readonly { startMinute: number; endMinute: number }[]> | undefined;
  now?: Date;
}): MoveCheck {
  if (start < now) return { ok: false, reason: 'No se puede mover una reunión al pasado' };

  const date = dateKey(start);
  const windows = openHours?.get(date);
  if (windows) {
    const startMinute = minuteOfDay(start);
    const endMinute = startMinute + Math.round((end.getTime() - start.getTime()) / 60_000);
    const sameDay = dateKey(new Date(end.getTime() - 1)) === date;
    if (!sameDay || !windows.some((window) => window.startMinute <= startMinute && endMinute <= window.endMinute)) {
      return { ok: false, reason: 'Ese horario está fuera del horario de atención' };
    }
  }

  const clash = meetings.some(
    (meeting) => meeting.id !== id && meeting.status === 'scheduled' && new Date(meeting.startsAt) < end && new Date(meeting.endsAt) > start,
  );
  return clash ? { ok: false, reason: 'Ese horario ya lo ocupa otra reunión' } : { ok: true };
}
