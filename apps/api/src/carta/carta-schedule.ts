import { type LocalClock, parseClock } from '../promotions/engine';

/** carta_settings.opening_hours (0035): ISO day "1".."7" -> null (closed) or {opens, closes} "HH:MM"; null = not configured. */
export type OpeningHours = Record<string, { opens: string; closes: string } | null> | null;

export interface OpeningState {
  /** Not configured hours are always open. */
  isOpenNow: boolean;
  /** "HH:MM" the current opening ends at (restaurant time); null when closed or always open. */
  closesAt: string | null;
  /** When closed: the next opening, inDays 0 = today; null when open or never open. */
  nextOpening: { date: string; opensAt: string; inDays: number } | null;
}

const dayAt = (isoDay: number, offset: number) => ((((isoDay - 1 + offset) % 7) + 7) % 7) + 1;

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * Open or closed at `now` (restaurant clock). A day's opening runs from opens
 * (inclusive) to closes (exclusive); closes < opens closes after midnight, so
 * the early hours of a day can still belong to the previous day's opening.
 */
export function openingState(hours: OpeningHours, now: LocalClock): OpeningState {
  if (hours === null) {
    return { isOpenNow: true, closesAt: null, nextOpening: null };
  }
  const entry = (isoDay: number) => hours[String(isoDay)] ?? null;
  const today = entry(now.isoDay);
  if (today) {
    const opens = parseClock(today.opens);
    const closes = parseClock(today.closes);
    if (now.minutes >= opens && (closes < opens || now.minutes < closes)) {
      return { isOpenNow: true, closesAt: today.closes, nextOpening: null };
    }
  }
  const yesterday = entry(dayAt(now.isoDay, -1));
  if (yesterday && parseClock(yesterday.closes) < parseClock(yesterday.opens) && now.minutes < parseClock(yesterday.closes)) {
    return { isOpenNow: true, closesAt: yesterday.closes, nextOpening: null };
  }
  for (let inDays = 0; inDays <= 7; inDays++) {
    const day = entry(dayAt(now.isoDay, inDays));
    if (day && (inDays > 0 || parseClock(day.opens) > now.minutes)) {
      return { isOpenNow: false, closesAt: null, nextOpening: { date: addDays(now.date, inDays), opensAt: day.opens, inDays } };
    }
  }
  return { isOpenNow: false, closesAt: null, nextOpening: null };
}

/** The daypart whose [startsAt, endsAt) holds `now` (dayparts never cross midnight, 0035); null between them. */
export function currentDaypartId(dayparts: readonly { id: string; startsAt: string; endsAt: string }[], now: LocalClock): string | null {
  return dayparts.find((d) => parseClock(d.startsAt) <= now.minutes && now.minutes < parseClock(d.endsAt))?.id ?? null;
}

export type CartaLang = 'es' | 'en';

/**
 * The guest's language (S10): the `lang` query, else the Accept-Language
 * entry of highest q whose primary tag is es or en (any region), else es.
 * Always es when the restaurant has English off.
 */
export function resolveLang(query: CartaLang | undefined, acceptLanguage: string | undefined, englishEnabled: boolean): CartaLang {
  if (!englishEnabled) {
    return 'es';
  }
  if (query) {
    return query;
  }
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/i.exec(p)?.[1]).find((v) => v !== undefined);
      return { primary: tag.trim().toLowerCase().split('-')[0], q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => (entry.primary === 'es' || entry.primary === 'en') && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return (ranked[0]?.primary as CartaLang | undefined) ?? 'es';
}
