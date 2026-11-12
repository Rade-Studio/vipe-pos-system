import { describe, expect, it } from 'vitest';
import { appliesToChannel, scheduleState, toLocalClock } from './schedule';
import { at, happyHour, promo } from './test-fixtures';

describe('scheduleState (S1)', () => {
  it('is active at 17:00 and reports the end of the window', () => {
    expect(scheduleState(happyHour(), at('17:00'))).toEqual({
      activeNow: true,
      endsAtMinutes: 19 * 60,
      nextStartTodayMinutes: null,
      reason: 'active',
    });
  });

  it('is not active at 19:00 (windows are [from, to))', () => {
    expect(scheduleState(happyHour(), at('19:00'))).toMatchObject({ activeNow: false, reason: 'outside_hours', nextStartTodayMinutes: null });
  });

  it('reports the next start later today', () => {
    expect(scheduleState(happyHour(), at('16:59'))).toEqual({
      activeNow: false,
      endsAtMinutes: null,
      nextStartTodayMinutes: 17 * 60,
      reason: 'outside_hours',
    });
  });

  it('is active all day with no windows, with no end time', () => {
    expect(scheduleState(promo({}), at('03:00'))).toEqual({ activeNow: true, endsAtMinutes: null, nextStartTodayMinutes: null, reason: 'active' });
  });

  it('is not active on another day of the week', () => {
    expect(scheduleState(promo({ daysOfWeek: [1, 3] }), at('12:00'))).toMatchObject({ activeNow: false, reason: 'other_day' });
    expect(scheduleState(promo({ daysOfWeek: [2] }), at('12:00')).activeNow).toBe(true);
  });

  it('is paused, not started, ended or manual', () => {
    expect(scheduleState(promo({ active: false }), at('12:00')).reason).toBe('paused');
    expect(scheduleState(promo({ startDate: '2026-12-01' }), at('12:00')).reason).toBe('not_started');
    expect(scheduleState(promo({ endDate: '2026-11-09' }), at('12:00')).reason).toBe('ended');
    expect(scheduleState(promo({ endDate: '2026-11-10' }), at('12:00')).activeNow).toBe(true);
    expect(scheduleState(promo({ mode: 'manual' }), at('12:00'))).toMatchObject({ activeNow: false, reason: 'manual' });
    expect(scheduleState(promo({ mode: 'manual_pin' }), at('12:00')).reason).toBe('manual');
  });
});

describe('appliesToChannel', () => {
  it('matches every channel when empty, else only the listed ones', () => {
    expect(appliesToChannel(promo({}), 'delivery')).toBe(true);
    expect(appliesToChannel(promo({ channels: ['delivery'] }), 'delivery')).toBe(true);
    expect(appliesToChannel(promo({ channels: ['delivery'] }), 'dine_in')).toBe(false);
  });
});

describe('toLocalClock', () => {
  it('converts an instant to America/Bogota (UTC−5)', () => {
    // 2026-11-11T00:30Z is Tuesday 2026-11-10 19:30 in Bogotá.
    expect(toLocalClock(new Date('2026-11-11T00:30:00Z'), 'America/Bogota')).toEqual({ isoDay: 2, minutes: 19 * 60 + 30, date: '2026-11-10' });
  });

  it('maps Sunday to 7 and midnight to 0', () => {
    expect(toLocalClock(new Date('2026-11-15T05:00:00Z'), 'America/Bogota')).toEqual({ isoDay: 7, minutes: 0, date: '2026-11-15' });
  });
});
