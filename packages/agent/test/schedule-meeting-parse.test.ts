import { describe, expect, it } from 'vitest';
import { parseStartsAt } from '../src/tools/schedule-meeting';

describe('parseStartsAt', () => {
  it('respeta el instante cuando trae zona', () => {
    expect(parseStartsAt('2026-10-20T15:00:00.000Z').toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(parseStartsAt('2026-10-20T12:00:00-03:00').toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(parseStartsAt('2026-10-20T12:00:00-0300').toISOString()).toBe('2026-10-20T15:00:00.000Z');
  });

  it('una hora sin zona es hora de Fab Lab, no la del servidor', () => {
    // 12:00 en Santiago es 15:00 UTC en octubre (UTC-3) y 16:00 UTC en abril (UTC-4).
    expect(parseStartsAt('2026-10-20T12:00').toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(parseStartsAt('2026-10-20T12:00:00').toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(parseStartsAt('2026-10-20 12:00').toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(parseStartsAt('2027-04-05T12:00').toISOString()).toBe('2027-04-05T16:00:00.000Z');
  });

  it('rechaza los formatos ambiguos o imposibles', () => {
    for (const value of ['mañana temprano', 'October 20 2026 12:00', '20/10/2026 12:00', '2026-02-30T12:00', '2026-10-20T25:00', '2026-10-20T12:75', '2026-10-20', '']) {
      expect(parseStartsAt(value).getTime(), value).toBeNaN();
    }
  });
});
