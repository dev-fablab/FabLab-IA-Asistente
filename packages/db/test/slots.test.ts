import { describe, expect, it } from 'vitest';
import {
  addDaysToDate,
  computeDayAvailability,
  dateInTimeZone,
  isDateString,
  mergeWindows,
  minuteOfDayInTimeZone,
  openWindowsFor,
  weekdayOf,
  type DateException,
  type WeeklyRule,
} from '../src/calendar/slots';

// Lunes a viernes, 08:00 a 20:00 (el horario base sembrado por la migración).
const baseRules: WeeklyRule[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 1200 }));
// Un domingo temprano: ninguna reserva cae dentro del plazo mínimo de anticipación.
const now = new Date('2026-10-18T12:00:00Z');
const day = (date: string, exceptions: DateException[] = [], meetings: { start: Date; end: Date }[] = [], at = now) =>
  computeDayAvailability({ date, rules: baseRules, exceptions, meetings, now: at });

describe('fechas de calendario', () => {
  it('valida que la fecha exista', () => {
    expect(isDateString('2026-10-26')).toBe(true);
    expect(isDateString('2026-02-30')).toBe(false);
    expect(isDateString('26-10-2026')).toBe(false);
  });

  it('calcula el día de la semana y suma días sin depender de la zona', () => {
    expect(weekdayOf('2026-10-26')).toBe(1);
    expect(weekdayOf('2026-10-25')).toBe(0);
    expect(addDaysToDate('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('usa la fecha de Santiago, no la UTC', () => {
    // 01:30 UTC del 27 es todavía el 26 por la noche en Chile (UTC-3 en octubre).
    expect(dateInTimeZone(new Date('2026-10-27T01:30:00Z'))).toBe('2026-10-26');
  });
});

describe('horario base', () => {
  it('un lunes ofrece 12 bloques de una hora entre 08:00 y 20:00', () => {
    const { free, open } = day('2026-10-26');
    expect(open).toEqual([{ startMinute: 480, endMinute: 1200 }]);
    expect(free).toHaveLength(12);
    expect(free[0]!.start.toISOString()).toBe('2026-10-26T11:00:00.000Z'); // 08:00 en UTC-3
    expect(free[11]!.end.toISOString()).toBe('2026-10-26T23:00:00.000Z'); // 20:00
  });

  it('sábado y domingo no tienen horarios', () => {
    expect(day('2026-10-24').free).toEqual([]);
    expect(day('2026-10-25').open).toEqual([]);
  });

  it('respeta el cambio de horario de verano (UTC-4 en abril)', () => {
    expect(day('2027-04-05').free[0]!.start.toISOString()).toBe('2027-04-05T12:00:00.000Z');
  });
});

describe('excepciones', () => {
  it('un cierre sin horas cierra el día entero', () => {
    expect(day('2026-10-26', [{ date: '2026-10-26', kind: 'closed', startMinute: null, endMinute: null }]).free).toEqual([]);
  });

  it('un cierre con ventana parte el horario', () => {
    const { open, free } = day('2026-10-26', [{ date: '2026-10-26', kind: 'closed', startMinute: 720, endMinute: 840 }]);
    expect(open).toEqual([
      { startMinute: 480, endMinute: 720 },
      { startMinute: 840, endMinute: 1200 },
    ]);
    expect(free).toHaveLength(10);
  });

  it('una apertura habilita un día sin horario base', () => {
    const { free } = day('2026-10-24', [{ date: '2026-10-24', kind: 'open', startMinute: 600, endMinute: 720 }]);
    expect(free.map((slot) => slot.start.toISOString())).toEqual(['2026-10-24T13:00:00.000Z', '2026-10-24T14:00:00.000Z']);
  });

  it('un cierre gana sobre una apertura del mismo día', () => {
    const exceptions: DateException[] = [
      { date: '2026-10-24', kind: 'closed', startMinute: null, endMinute: null },
      { date: '2026-10-24', kind: 'open', startMinute: 600, endMinute: 720 },
    ];
    expect(openWindowsFor('2026-10-24', baseRules, exceptions)).toEqual([]);
  });

  it('ignora las excepciones de otras fechas', () => {
    expect(day('2026-10-26', [{ date: '2026-10-27', kind: 'closed', startMinute: null, endMinute: null }]).free).toHaveLength(12);
  });
});

describe('reuniones y anticipación', () => {
  it('quita el bloque ocupado y lo informa en busy', () => {
    const meeting = { start: new Date('2026-10-26T14:00:00Z'), end: new Date('2026-10-26T15:00:00Z') }; // 11:00 a 12:00
    const { free, busy } = day('2026-10-26', [], [meeting]);
    expect(free).toHaveLength(11);
    expect(free.some((slot) => slot.start.getTime() === meeting.start.getTime())).toBe(false);
    expect(busy).toEqual([meeting]);
  });

  it('una reunión que solo roza un bloque contiguo no lo ocupa', () => {
    const meeting = { start: new Date('2026-10-26T14:00:00Z'), end: new Date('2026-10-26T15:00:00Z') };
    const starts = day('2026-10-26', [], [meeting]).free.map((slot) => slot.start.toISOString());
    expect(starts).toContain('2026-10-26T13:00:00.000Z');
    expect(starts).toContain('2026-10-26T15:00:00.000Z');
  });

  it('no ofrece horarios dentro del plazo mínimo de anticipación', () => {
    // Son las 09:30 en Chile: con 2 h de anticipación el primer bloque válido es el de 12:00.
    const { free } = day('2026-10-26', [], [], new Date('2026-10-26T12:30:00Z'));
    expect(free[0]!.start.toISOString()).toBe('2026-10-26T15:00:00.000Z');
  });
});

describe('ventanas', () => {
  it('une las que se solapan o se tocan', () => {
    expect(
      mergeWindows([
        { startMinute: 600, endMinute: 720 },
        { startMinute: 480, endMinute: 600 },
        { startMinute: 900, endMinute: 960 },
      ]),
    ).toEqual([
      { startMinute: 480, endMinute: 720 },
      { startMinute: 900, endMinute: 960 },
    ]);
  });
});

describe('hora del día en la zona de Fab Lab', () => {
  it('cuenta los minutos desde la medianoche de Santiago, no de UTC', () => {
    expect(minuteOfDayInTimeZone(new Date('2026-10-20T15:00:00Z'))).toBe(12 * 60); // UTC-3 en octubre
    expect(minuteOfDayInTimeZone(new Date('2027-04-05T16:30:00Z'))).toBe(12 * 60 + 30); // UTC-4 en abril
    expect(minuteOfDayInTimeZone(new Date('2026-10-27T01:30:00Z'))).toBe(22 * 60 + 30); // aún el día anterior
  });
});
