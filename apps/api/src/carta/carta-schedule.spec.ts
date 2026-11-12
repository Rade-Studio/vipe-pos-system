import { describe, expect, it } from 'vitest';
import type { LocalClock } from '../promotions/engine';
import { currentDaypartId, type OpeningHours, openingState, resolveLang } from './carta-schedule';

/** 2026-11-09 is a Monday (isoDay 1). */
const at = (isoDay: number, hhmm: string): LocalClock => {
  const [h, m] = hhmm.split(':').map(Number);
  return { isoDay, minutes: h * 60 + m, date: `2026-11-${String(8 + isoDay).padStart(2, '0')}` };
};

const week = (entry: { opens: string; closes: string } | null): OpeningHours =>
  Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((day) => [String(day), entry]));

describe('openingState', () => {
  it('null hours = always open, nothing to close or reopen', () => {
    expect(openingState(null, at(3, '03:00'))).toEqual({ isOpenNow: true, closesAt: null, nextOpening: null });
  });

  it('opens at opens (inclusive) and closes at closes (exclusive)', () => {
    const hours = week({ opens: '12:00', closes: '22:00' });
    expect(openingState(hours, at(1, '12:00'))).toEqual({ isOpenNow: true, closesAt: '22:00', nextOpening: null });
    expect(openingState(hours, at(1, '21:59')).isOpenNow).toBe(true);
    expect(openingState(hours, at(1, '22:00'))).toEqual({
      isOpenNow: false,
      closesAt: null,
      nextOpening: { date: '2026-11-10', opensAt: '12:00', inDays: 1 },
    });
  });

  it('before opening: reopens later the same day', () => {
    expect(openingState(week({ opens: '07:00', closes: '22:30' }), at(1, '06:59'))).toEqual({
      isOpenNow: false,
      closesAt: null,
      nextOpening: { date: '2026-11-09', opensAt: '07:00', inDays: 0 },
    });
  });

  it('closing after midnight: the spill belongs to the previous day', () => {
    const hours: OpeningHours = { ...week(null), '5': { opens: '18:00', closes: '02:00' } };
    expect(openingState(hours, at(5, '23:30'))).toEqual({ isOpenNow: true, closesAt: '02:00', nextOpening: null });
    expect(openingState(hours, at(6, '01:59'))).toEqual({ isOpenNow: true, closesAt: '02:00', nextOpening: null });
    expect(openingState(hours, at(6, '02:00'))).toEqual({
      isOpenNow: false,
      closesAt: null,
      nextOpening: { date: '2026-11-20', opensAt: '18:00', inDays: 6 },
    });
    // Friday 01:00 is Thursday's night, and Thursday is closed.
    expect(openingState(hours, at(5, '01:00')).isOpenNow).toBe(false);
  });

  it('Sunday night spills into Monday', () => {
    const hours: OpeningHours = { ...week(null), '7': { opens: '20:00', closes: '01:00' } };
    expect(openingState(hours, at(1, '00:30'))).toMatchObject({ isOpenNow: true, closesAt: '01:00' });
  });

  it('the only open day already passed this week: same weekday next week', () => {
    const hours: OpeningHours = { ...week(null), '3': { opens: '09:00', closes: '17:00' } };
    expect(openingState(hours, at(3, '18:00')).nextOpening).toEqual({ date: '2026-11-18', opensAt: '09:00', inDays: 7 });
  });

  it('closed every day: closed with no next opening', () => {
    expect(openingState(week(null), at(2, '12:00'))).toEqual({ isOpenNow: false, closesAt: null, nextOpening: null });
  });

  it('crosses a month boundary', () => {
    const now: LocalClock = { isoDay: 1, minutes: 23 * 60, date: '2026-11-30' };
    expect(openingState(week({ opens: '07:00', closes: '22:00' }), now).nextOpening).toEqual({
      date: '2026-12-01',
      opensAt: '07:00',
      inDays: 1,
    });
  });
});

describe('currentDaypartId', () => {
  const dayparts = [
    { id: 'desayuno', startsAt: '07:00', endsAt: '11:00' },
    { id: 'almuerzo', startsAt: '11:30', endsAt: '15:30' },
    { id: 'noche', startsAt: '18:00', endsAt: '22:30' },
  ];

  it('the daypart whose [startsAt, endsAt) contains now', () => {
    expect(currentDaypartId(dayparts, at(1, '07:00'))).toBe('desayuno');
    expect(currentDaypartId(dayparts, at(1, '10:59'))).toBe('desayuno');
    expect(currentDaypartId(dayparts, at(1, '11:00'))).toBeNull();
    expect(currentDaypartId(dayparts, at(1, '11:30'))).toBe('almuerzo');
    expect(currentDaypartId(dayparts, at(1, '22:29'))).toBe('noche');
    expect(currentDaypartId(dayparts, at(1, '22:30'))).toBeNull();
  });

  it('none configured: null', () => {
    expect(currentDaypartId([], at(1, '12:00'))).toBeNull();
  });
});

describe('resolveLang', () => {
  it('the lang query wins over the header', () => {
    expect(resolveLang('es', 'en-US,en;q=0.9', true)).toBe('es');
    expect(resolveLang('en', 'es-CO', true)).toBe('en');
  });

  it('Accept-Language: the preferred of es/en by q, any region', () => {
    expect(resolveLang(undefined, 'en-US,en;q=0.9', true)).toBe('en');
    expect(resolveLang(undefined, 'EN-gb', true)).toBe('en');
    expect(resolveLang(undefined, 'es-CO,es;q=0.9,en;q=0.8', true)).toBe('es');
    expect(resolveLang(undefined, 'fr-FR, en;q=0.5', true)).toBe('en');
    expect(resolveLang(undefined, 'es;q=0.4, en;q=0.6', true)).toBe('en');
    expect(resolveLang(undefined, 'en;q=0', true)).toBe('es');
  });

  it('defaults to es without a usable header', () => {
    expect(resolveLang(undefined, undefined, true)).toBe('es');
    expect(resolveLang(undefined, '', true)).toBe('es');
    expect(resolveLang(undefined, '*', true)).toBe('es');
    expect(resolveLang(undefined, 'fr-FR,de', true)).toBe('es');
    expect(resolveLang(undefined, 'eng', true)).toBe('es');
  });

  it('always es when the restaurant has English off', () => {
    expect(resolveLang('en', 'en-US', false)).toBe('es');
    expect(resolveLang(undefined, 'en-US', false)).toBe('es');
  });
});
