import type { EnginePromotion, LocalClock, ScheduleState } from './types';

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** 'HH:MM' → minutes since midnight. */
export function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** The instant as the restaurant's local weekday, minute of day and date. */
export function toLocalClock(instant: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    isoDay: WEEKDAYS[part('weekday')],
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
    date: `${part('year')}-${part('month')}-${part('day')}`,
  };
}

/**
 * Whether the promotion applies by itself right now. Manual modes never do.
 * Windows are [from, to); dates are inclusive.
 */
export function scheduleState(promotion: EnginePromotion<string>, now: LocalClock): ScheduleState {
  const off = (reason: ScheduleState['reason'], nextStartTodayMinutes: number | null = null): ScheduleState => ({
    activeNow: false,
    endsAtMinutes: null,
    nextStartTodayMinutes,
    reason,
  });

  if (!promotion.active) return off('paused');
  if (now.date < promotion.startDate) return off('not_started');
  if (promotion.endDate !== null && now.date > promotion.endDate) return off('ended');
  if (promotion.mode !== 'automatic') return off('manual');
  if (promotion.daysOfWeek.length > 0 && !promotion.daysOfWeek.includes(now.isoDay)) return off('other_day');
  if (promotion.timeWindows.length === 0) {
    return { activeNow: true, endsAtMinutes: null, nextStartTodayMinutes: null, reason: 'active' };
  }

  const windows = promotion.timeWindows.map((w) => ({ from: parseClock(w.from), to: parseClock(w.to) }));
  const current = windows.find((w) => now.minutes >= w.from && now.minutes < w.to);
  if (current) return { activeNow: true, endsAtMinutes: current.to, nextStartTodayMinutes: null, reason: 'active' };

  const later = windows.filter((w) => w.from > now.minutes).map((w) => w.from);
  return off('outside_hours', later.length > 0 ? Math.min(...later) : null);
}

/** Empty channel list = every channel. */
export function appliesToChannel<C extends string>(promotion: EnginePromotion<C>, channel: C): boolean {
  return promotion.channels.length === 0 || promotion.channels.includes(channel);
}

/** Automatic, active now and valid for the channel. */
export function isLiveFor<C extends string>(promotion: EnginePromotion<C>, now: LocalClock, channel: C): boolean {
  return scheduleState(promotion, now).activeNow && appliesToChannel(promotion, channel);
}
