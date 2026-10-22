import { renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { EventCalendarProposedUpdate } from '@/components/reui/event-calendar/event-calendar-types';
import type { MeetingRow } from '@/lib/calendar';
import { json, mockApi } from '@/test/fetch-mock';
import { useMeetingMover } from './use-meeting-mover';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } }),
}));

const ID = '00000000-0000-4000-8000-000000000042';
// 2030-03-04 es lunes y Santiago está en UTC-3: las 11:00 locales son las 14:00 UTC.
const hour = (h: number) => new Date(Date.UTC(2030, 2, 4, h + 3));
const open = new Map([['2030-03-04', [{ startMinute: 480, endMinute: 1200 }]]]);

const meeting = (overrides: Partial<MeetingRow> = {}): MeetingRow => ({
  id: ID,
  startsAt: hour(11).toISOString(),
  endsAt: hour(12).toISOString(),
  status: 'scheduled',
  reason: 'Visita',
  contactName: 'Camila Rojas',
  contactEmail: 'camila@correo.cl',
  responsibleId: null,
  responsibleName: null,
  ...overrides,
});

const update = (start: Date, end: Date, extra: Partial<EventCalendarProposedUpdate<MeetingRow>> = {}) =>
  ({ event: { id: ID, title: 't', start: hour(11), end: hour(12), data: meeting() }, occurrence: null, start, end, allDay: false, source: 'drag', ...extra }) as EventCalendarProposedUpdate<MeetingRow>;

let api: ReturnType<typeof mockApi>;
let setTimes: Mock<(id: string, startsAt: string, endsAt: string) => void>;

const mover = (meetings = [meeting()]) => renderHook(() => useMeetingMover({ meetings, openHours: open, setTimes })).result.current;

beforeEach(() => {
  api = mockApi();
  setTimes = vi.fn<(id: string, startsAt: string, endsAt: string) => void>();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const saved = (start: Date, end: Date) =>
  json({ meeting: { ...meeting(), startsAt: start.toISOString(), endsAt: end.toISOString() }, responsible: null, minutes: [] });

describe('useMeetingMover: validación mientras se arrastra', () => {
  it('canDropEvent acepta el horario de atención y rechaza lo demás', () => {
    const { canDropEvent } = mover();
    expect(canDropEvent(update(hour(9), hour(10)))).toBe(true);
    expect(canDropEvent(update(hour(21), hour(22)))).toBe(false); // fuera del horario
    expect(canDropEvent(update(hour(9), hour(10), { allDay: true }))).toBe(false);
  });

  it('canDropEvent rechaza el choque con otra reunión', () => {
    const other = meeting({ id: 'otra', startsAt: hour(15).toISOString(), endsAt: hour(16).toISOString() });
    const { canDropEvent } = mover([meeting(), other]);
    expect(canDropEvent(update(hour(15), hour(16)))).toBe(false);
    expect(canDropEvent(update(hour(16), hour(17)))).toBe(true);
  });
});

describe('useMeetingMover: al soltar', () => {
  it('mueve de inmediato, guarda en la API con el instante exacto y confirma con la opción de deshacer', async () => {
    api.on(`PATCH /api/admin/calendar/meetings/${ID}`, (call) => {
      expect(call.body).toEqual({ startsAt: hour(9).toISOString() });
      return saved(hour(9), hour(10));
    });
    const { onEventUpdate } = mover();

    expect(onEventUpdate(update(hour(9), hour(10)))).toBe(true);
    expect(setTimes).toHaveBeenNthCalledWith(1, ID, hour(9).toISOString(), hour(10).toISOString()); // optimista

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(setTimes).toHaveBeenLastCalledWith(ID, hour(9).toISOString(), hour(10).toISOString()); // lo que respondió el servidor
    const [title, options] = vi.mocked(toast.success).mock.calls[0]!;
    expect(title).toBe('Reunión reagendada');
    expect(options?.description).toMatch(/no recibe un aviso automático/);
    expect(options?.action).toMatchObject({ label: 'Deshacer' });
  });

  it('deshacer devuelve la reunión a su horario anterior y no ofrece deshacer otra vez', async () => {
    let calls = 0;
    api.on(`PATCH /api/admin/calendar/meetings/${ID}`, (call) => {
      calls++;
      const start = new Date((call.body as { startsAt: string }).startsAt);
      return saved(start, new Date(start.getTime() + 3_600_000));
    });
    const { onEventUpdate } = mover();
    onEventUpdate(update(hour(9), hour(10)));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

    const action = vi.mocked(toast.success).mock.calls[0]![1]!.action as unknown as { onClick: () => void };
    action.onClick();
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));

    expect(calls).toBe(2);
    expect(api.calls[1]!.body).toEqual({ startsAt: hour(11).toISOString() });
    expect(setTimes).toHaveBeenLastCalledWith(ID, hour(11).toISOString(), hour(12).toISOString());
    expect(vi.mocked(toast.success).mock.calls[1]![1]).not.toHaveProperty('action');
  });

  it('si el servidor lo rechaza, la reunión vuelve a su lugar y se explica el motivo', async () => {
    api.on(`PATCH /api/admin/calendar/meetings/${ID}`, () => json({ error: { code: 'conflict', message: 'Ese horario ya lo ocupa otra reunión' } }, 409));
    const { onEventUpdate } = mover();

    expect(onEventUpdate(update(hour(9), hour(10)))).toBe(true);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ese horario ya lo ocupa otra reunión'));

    expect(setTimes).toHaveBeenNthCalledWith(1, ID, hour(9).toISOString(), hour(10).toISOString());
    expect(setTimes).toHaveBeenLastCalledWith(ID, hour(11).toISOString(), hour(12).toISOString());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('un movimiento inválido se rechaza sin llamar a la API', () => {
    const { onEventUpdate } = mover();

    expect(onEventUpdate(update(hour(21), hour(22)))).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Ese horario está fuera del horario de atención');
    expect(api.calls).toHaveLength(0);
    expect(setTimes).not.toHaveBeenCalled();
  });

  it('soltar en el mismo lugar, una reunión desconocida o un bloque de todo el día no hacen nada', () => {
    const { onEventUpdate } = mover();

    expect(onEventUpdate(update(hour(11), hour(12)))).toBe(false);
    expect(onEventUpdate(update(hour(9), hour(10), { event: { id: 'desconocida', title: 't', start: hour(9), end: hour(10) } }))).toBe(false);
    expect(onEventUpdate(update(hour(9), hour(10), { allDay: true }))).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it('avisa cuando se intenta mover una reunión que no se puede', () => {
    mover().onDragBlocked();
    expect(toast.info).toHaveBeenCalledWith('Solo se pueden mover las reuniones agendadas');
  });
});
