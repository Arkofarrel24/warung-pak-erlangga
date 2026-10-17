/**
 * The day's challenge: a small goal set each morning and judged at night
 * from the day's own results. Nothing here touches the simulation; a
 * challenge only reads the totals the report already holds.
 */

import { createRng, STREAM } from '../sim/rng.js';
import { CHALLENGES } from './config.js';

/** Each challenge: what it measures on a day's results, and whether the day met it. */
const RULES = Object.freeze({
  served: (results) => results.arrivals > 0 && results.served / results.arrivals >= CHALLENGES.servedShare,
  patient: (results) => results.reneged <= CHALLENGES.reneged,
  kept: (results) => lostCustomers(results) <= CHALLENGES.lost,
  stock: (results) => stockMiss(results) <= CHALLENGES.stockMiss,
});

export const CHALLENGE_IDS = Object.freeze(Object.keys(RULES));

/** Customers lost in any way: gave up waiting, found the place full, or found nothing left. */
export function lostCustomers(results) {
  return results.reneged + results.rejected + results.soldOut;
}

/** How far the stock was from the day's demand: portions over, plus customers it fell short by. */
export function stockMiss(results) {
  return results.stockLeft + results.soldOut;
}

/** The challenge of a day: fixed by the game's seed and the day, like everything else. */
export function challengeForDay(seed, day) {
  const rng = createRng(seed, day, STREAM.CHALLENGES);
  return CHALLENGE_IDS[Math.floor(rng() * CHALLENGE_IDS.length)];
}

/** Whether a day's results meet a challenge. An unknown challenge is never met. */
export function challengeMet(id, results) {
  return Boolean(RULES[id]?.(results));
}
