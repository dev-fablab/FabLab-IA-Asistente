import { toast } from 'sonner';
import type { EventCalendarProposedUpdate } from '@/components/reui/event-calendar/event-calendar-types';
import { api, unwrap } from '@/lib/api';
import { canMoveMeeting, formatMeetingRange, type MeetingDetail, type MeetingRow, type OpenHoursDay } from '@/lib/calendar';

type Params = {
  meetings: readonly MeetingRow[] | undefined;
  openHours: ReadonlyMap<string, OpenHoursDay['open']> | undefined;
  /** Refleja un horario en la lista que alimenta al calendario. */
  setTimes: (id: string, startsAt: string, endsAt: string) => void;
};

/**
 * Reagendar arrastrando. El calendario valida mientras se arrastra (`canDropEvent`) y confirma al soltar
 * (`onEventUpdate`); aquí se decide con la misma regla que aplica el servidor, se muestra el movimiento de
 * inmediato y se guarda. Si la API lo rechaza (la decisión final es suya: horario, choques, estado) la
 * reunión vuelve a donde estaba y se explica el motivo. Tras mover se ofrece «Deshacer».
 */
export function useMeetingMover({ meetings, openHours, setTimes }: Params) {
  const list = meetings ?? [];

  async function persistMove(meeting: Pick<MeetingRow, 'id' | 'startsAt' | 'endsAt'>, start: Date, end: Date, canUndo: boolean) {
    const previous = { startsAt: meeting.startsAt, endsAt: meeting.endsAt };
    const next = { startsAt: new Date(start.getTime()).toISOString(), endsAt: new Date(end.getTime()).toISOString() };
    setTimes(meeting.id, next.startsAt, next.endsAt);
    try {
      const { meeting: saved } = await unwrap<MeetingDetail>(
        await api.api.admin.calendar.meetings[':id'].$patch({ param: { id: meeting.id }, json: { startsAt: next.startsAt } }),
      );
      setTimes(meeting.id, saved.startsAt, saved.endsAt);
      toast.success('Reunión reagendada', {
        description: `${formatMeetingRange(saved.startsAt, saved.endsAt)}. La persona no recibe un aviso automático.`,
        ...(canUndo && {
          action: {
            label: 'Deshacer',
            onClick: () => void persistMove({ id: meeting.id, ...next }, new Date(previous.startsAt), new Date(previous.endsAt), false),
          },
        }),
      });
    } catch (cause) {
      setTimes(meeting.id, previous.startsAt, previous.endsAt);
      toast.error(cause instanceof Error ? cause.message : 'No se pudo reagendar la reunión');
    }
  }

  return {
    persistMove,
    /** Mientras se arrastra, el calendario marca los bloques donde la reunión no cabe. */
    canDropEvent: (update: EventCalendarProposedUpdate<MeetingRow>) =>
      !update.allDay && canMoveMeeting({ id: String(update.event.id), start: update.start, end: update.end, meetings: list, openHours }).ok,
    /** Al soltar: `false` devuelve la reunión a su lugar; `true` la deja y la guarda. */
    onEventUpdate: (update: EventCalendarProposedUpdate<MeetingRow>) => {
      const meeting = list.find((item) => item.id === String(update.event.id));
      if (!meeting || update.allDay || update.start.getTime() === new Date(meeting.startsAt).getTime()) return false;
      const check = canMoveMeeting({ id: meeting.id, start: update.start, end: update.end, meetings: list, openHours });
      if (!check.ok) {
        toast.error(check.reason);
        return false;
      }
      void persistMove(meeting, update.start, update.end, true);
      return true;
    },
    onDragBlocked: () => {
      toast.info('Solo se pueden mover las reuniones agendadas');
    },
  };
}
