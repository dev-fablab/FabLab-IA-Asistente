import { describe, expect, it } from 'vitest';
import { canMoveMeeting, shortName, toCalendarEvent, zonedInstant, type MeetingRow } from './calendar';

// Fechas lejanas para que "no es el pasado" no dependa de cuándo se corre la prueba. 2030-03-04 es lunes y en
// marzo Santiago está en UTC-3: las 11:00 locales son las 14:00 UTC.
const hour = (h: number, day = '2030-03-04') => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h + 3));
};
const open = new Map([['2030-03-04', [{ startMinute: 480, endMinute: 1200 }]]]);

const meeting = (overrides: Partial<MeetingRow> = {}): MeetingRow => ({
  id: 'm1',
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

describe('canMoveMeeting', () => {
  const check = (start: Date, end: Date, meetings: MeetingRow[] = [meeting()]) =>
    canMoveMeeting({ id: 'm1', start, end, meetings, openHours: open });

  it('permite un bloque dentro del horario de atención, incluso pegado al cierre', () => {
    expect(check(hour(9), hour(10))).toEqual({ ok: true });
    expect(check(hour(19), hour(20))).toEqual({ ok: true });
    expect(check(new Date(hour(8).getTime() + 15 * 60_000), new Date(hour(9).getTime() + 15 * 60_000))).toEqual({ ok: true });
  });

  it('rechaza lo que sale del horario de atención', () => {
    for (const [start, end] of [[hour(7), hour(8)], [new Date(hour(19).getTime() + 30 * 60_000), new Date(hour(20).getTime() + 30 * 60_000)], [hour(21), hour(22)]] as const) {
      expect(check(start, end)).toEqual({ ok: false, reason: 'Ese horario está fuera del horario de atención' });
    }
  });

  it('rechaza un día sin atención', () => {
    expect(canMoveMeeting({ id: 'm1', start: hour(10, '2030-03-09'), end: hour(11, '2030-03-09'), meetings: [], openHours: new Map([['2030-03-09', []]]) })).toMatchObject({ ok: false });
  });

  it('rechaza el choque con otra reunión agendada, también parcial, pero no con una cancelada ni consigo misma', () => {
    const other = meeting({ id: 'm2', startsAt: hour(15).toISOString(), endsAt: hour(16).toISOString() });
    const half = new Date(hour(14).getTime() + 30 * 60_000);
    expect(check(half, new Date(half.getTime() + 3_600_000), [meeting(), other])).toEqual({ ok: false, reason: 'Ese horario ya lo ocupa otra reunión' });
    expect(check(hour(14), hour(15), [meeting(), other])).toEqual({ ok: true });
    expect(check(hour(15), hour(16), [meeting(), { ...other, status: 'cancelled' }])).toEqual({ ok: true });
    expect(check(hour(11), hour(12))).toEqual({ ok: true });
  });

  it('rechaza el pasado', () => {
    expect(canMoveMeeting({ id: 'm1', start: hour(9), end: hour(10), meetings: [], openHours: open, now: hour(12) })).toEqual({
      ok: false,
      reason: 'No se puede mover una reunión al pasado',
    });
  });

  it('si el horario de ese día no está cargado, deja que decida el servidor', () => {
    expect(canMoveMeeting({ id: 'm1', start: hour(23), end: new Date(hour(23).getTime() + 3_600_000), meetings: [], openHours: undefined })).toEqual({ ok: true });
  });
});

describe('toCalendarEvent', () => {
  it('muestra al solicitante y al responsable, o que no lo hay', () => {
    expect(toCalendarEvent(meeting()).title).toBe('Camila Rojas · sin responsable');
    expect(toCalendarEvent(meeting({ responsibleId: 'p1', responsibleName: 'Ana Pérez' })).title).toBe('Camila Rojas · Ana');
    expect(toCalendarEvent(meeting({ responsibleId: 'p1', responsibleName: 'ana@fablab.cl' })).title).toBe('Camila Rojas · ana');
  });

  it('marca en amarillo lo que no tiene responsable y deja en calma lo ya cerrado', () => {
    expect(toCalendarEvent(meeting()).color).toBe('var(--warning)');
    expect(toCalendarEvent(meeting({ responsibleId: 'p1', responsibleName: 'Ana' })).color).toBe('var(--primary)');
    expect(toCalendarEvent(meeting({ status: 'completed' })).color).toBe('var(--muted-foreground)');
  });

  it('solo las agendadas se pueden arrastrar y ninguna cambia de duración', () => {
    expect(toCalendarEvent(meeting())).toMatchObject({ readOnly: false, draggable: true, resizable: false });
    for (const status of ['completed', 'cancelled'] as const) {
      expect(toCalendarEvent(meeting({ status }))).toMatchObject({ readOnly: true, draggable: false });
    }
  });
});

describe('zonedInstant y shortName', () => {
  it('interpreta fecha y hora en la zona de Fab Lab', () => {
    expect(zonedInstant('2030-03-04', '11:00').toISOString()).toBe('2030-03-04T14:00:00.000Z'); // UTC-3
    expect(zonedInstant('2030-07-01', '11:00').toISOString()).toBe('2030-07-01T15:00:00.000Z'); // UTC-4 en invierno
  });

  it('acorta nombres y correos', () => {
    expect(shortName('Ana Pérez')).toBe('Ana');
    expect(shortName('ana.perez@fablab.cl')).toBe('ana.perez');
    expect(shortName('  Luis  ')).toBe('Luis');
  });
});
