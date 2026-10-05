/**
 * The unexpected: which event a day brings, and what it does to the day.
 *
 * Whether a day has an event, and which, follows from the game's seed and
 * the day number alone. So a saved game brings the same events when it is
 * loaded again, and the morning can show today's news before the day is
 * played.
 */

import { createRng, STREAM } from '../sim/rng.js';
import { COSTS, DAY, EVENTS, SHIFTS } from './config.js';

export const EVENT_KIND = Object.freeze({
  /** Known in the morning, before the player decides. */
  NEWS: 'news',
  /** Happens once the warung is open. */
  SURPRISE: 'surprise',
});

const QUARTER_HOUR = 0.25;

/**
 * The event of a day, or null on an ordinary day.
 *
 * @param {number} seed the game's seed
 * @param {number} day  the day number, from 1
 * @returns {{ id: string, kind: string, time?: number } | null}
 *   `time` (hours since opening) is set for events that strike at a moment
 */
export function eventForDay(seed, day) {
  if (day < EVENTS.firstDay) return null;

  const rng = createRng(seed, day, STREAM.EVENTS);
  if (rng() >= EVENTS.chance) return null;

  const ids = Object.keys(EVENTS.catalog);
  const id = ids[Math.floor(rng() * ids.length)];
  const spec = EVENTS.catalog[id];
  const event = { id, kind: spec.kind };
  if (spec.earliest !== undefined) {
    const moment = spec.earliest + rng() * (spec.latest - spec.earliest);
    event.time = Math.round(moment / QUARTER_HOUR) * QUARTER_HOUR;
  }
  return event;
}

const specOf = (event) => (event ? EVENTS.catalog[event.id] : null);

/** What the player knows of today's event in the morning: news, but not surprises. */
export function morningNews(event) {
  return event?.kind === EVENT_KIND.NEWS ? event : null;
}

/** Ingredient cost per portion today. */
export function ingredientCost(event) {
  return Math.round(COSTS.ingredient * (specOf(event)?.costFactor ?? 1));
}

/**
 * The arrival profile with the event's change in demand applied: the whole
 * curve scaled, or only the part from a moment on (the hour `from` of the
 * event's kind, or the moment a surprise strikes). A change that starts
 * mid-day is a jump, written as two points at the same time.
 *
 * @param {{ time: number, rate: number }[]} profile points at the full hours
 */
export function eventArrivalProfile(profile, event) {
  const spec = specOf(event);
  if (!spec?.demandFactor) return profile;
  const from = spec.from ?? event.time ?? 0;
  const scaled = (point) => ({ time: point.time, rate: point.rate * spec.demandFactor });

  const points = [];
  profile.forEach((point, i) => {
    const previous = profile[i - 1];
    if (point.time < from) {
      points.push(point);
      return;
    }
    if (previous && previous.time < from) {
      // The jump. Between two points of the profile the rate before it is
      // read off the straight line that joins them.
      const share = (from - previous.time) / (point.time - previous.time);
      const before = point.time === from ? point : { time: from, rate: previous.rate + (point.rate - previous.rate) * share };
      points.push(before, scaled(before));
      if (point.time === from) return;
    }
    points.push(scaled(point));
  });
  return points;
}

/**
 * The number of pegawai through the day, c(t), with the event applied.
 *
 * @param {number[]} staff pegawai per shift, as decided
 * @returns {{ time: number, servers: number }[]} one entry per change, the first at time 0
 */
export function eventStaffSchedule(staff, event) {
  const spec = specOf(event);
  const change = spec?.staffChange ?? 0;
  // The change lasts all day, or `duration` hours from the moment the event strikes.
  const from = change === 0 ? Infinity : (event.time ?? 0);
  const until = spec?.duration === undefined ? Infinity : from + spec.duration;

  const onDutyAt = (time) => {
    const shift = SHIFTS.findIndex((candidate) => time < candidate.to);
    const decided = staff[shift === -1 ? SHIFTS.length - 1 : shift];
    const changed = time >= from && time < until ? change : 0;
    // The warung never runs with nobody: the owner steps in.
    return Math.max(decided + changed, 1);
  };

  const moments = [...SHIFTS.map((shift) => shift.from), from, until]
    .filter((time) => time < DAY.hours)
    .sort((a, b) => a - b);
  const schedule = [];
  for (const time of moments) {
    const servers = onDutyAt(time);
    if (schedule.length === 0 || schedule.at(-1).servers !== servers) schedule.push({ time, servers });
  }
  return schedule;
}

/** Pegawai-hours over the opening hours of a schedule. */
function staffHours(schedule) {
  return schedule.reduce((hours, entry, i) => {
    const until = schedule[i + 1]?.time ?? DAY.hours;
    return hours + entry.servers * (until - entry.time);
  }, 0);
}

/**
 * Hours at the counter that the wage bill does not follow: positive for
 * someone who serves without being paid, negative for a pegawai who is paid
 * while away from the counter. Zero for every other event.
 *
 * @param {number[]} staff pegawai per shift, as decided
 */
export function hoursOffPayroll(staff, event) {
  if (!specOf(event)?.wagesUnchanged) return 0;
  return staffHours(eventStaffSchedule(staff, event)) - staffHours(eventStaffSchedule(staff, null));
}

/** Groups that arrive all at once today. */
export function eventBatchArrivals(event) {
  const spec = specOf(event);
  return spec?.size ? [{ time: event.time, size: spec.size }] : [];
}
