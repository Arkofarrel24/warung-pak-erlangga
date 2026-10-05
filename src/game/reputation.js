/**
 * Reputation: yesterday's service decides how many customers come today.
 *
 * The rules and their reasons are written out next to the numbers, in
 * REPUTATION in config.js.
 */

import { REPUTATION } from './config.js';

/**
 * The day's score, 0 to 100, from the results of the simulated day.
 *
 * Only totals are needed: customers served, customers lost in each way, and
 * the total time spent waiting. The last is the area under the queue-length
 * curve, the same quantity that Lq is the time average of, and it counts the
 * waiting of everyone who joined the line, including those who then gave up.
 *
 * @returns {number | null} null on a day without a single customer, when
 *   there is nobody to tell anyone anything
 */
export function dayScore({ arrivals, served, reneged, rejected, soldOut, totalQueueTime }) {
  if (!(arrivals > 0)) return null;
  const points =
    served -
    totalQueueTime / REPUTATION.waitTolerance -
    REPUTATION.renegePenalty * reneged -
    REPUTATION.turnedAwayPenalty * (rejected + soldOut);
  return 100 * Math.min(Math.max(points / arrivals, 0), 1);
}

/**
 * Exponential smoothing: the reputation moves a fixed share of the way
 * toward the day's score.
 */
export function nextReputation(reputation, score) {
  if (score === null) return reputation;
  return reputation + REPUTATION.memory * (score - reputation);
}
