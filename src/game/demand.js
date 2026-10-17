/**
 * Demand: how many customers come, and when.
 *
 * The shape of the day is fixed (DEMAND.baseProfile). The player moves the
 * whole curve up or down through two levers: the price, and the reputation
 * earned on earlier days. The result is the arrival rate λ(t) that goes into
 * the simulation.
 */

import { DEMAND, GROWTH } from './config.js';

/**
 * Exponential (log-linear) demand: e^(-(p - p0)/s).
 * 1 at the reference price, lower when dearer, higher when cheaper.
 */
export function priceFactor(price) {
  return Math.exp(-(price - DEMAND.referencePrice) / DEMAND.priceSensitivity);
}

/** Word of mouth: 0.4 at a reputation of 0, 1 at 50, 1.6 at 100. */
export function reputationFactor(reputation) {
  return DEMAND.reputationFloor + (DEMAND.reputationSlope * reputation) / 100;
}

/** A warung that has been open a week is known: 1 in the first week, GROWTH.demandFactor after it. */
export function growthFactor(day) {
  return day >= GROWTH.fromDay ? GROWTH.demandFactor : 1;
}

/**
 * λ(t) for one day, as { time, rate } points for the simulation engine:
 * the base profile scaled by the price factor, the reputation factor, and
 * (from the second week) the growth factor.
 *
 * @param {number} [day] the day of the game; without it, a day of the first week
 */
export function arrivalProfile({ price, reputation, day = 1 }) {
  const factor = priceFactor(price) * reputationFactor(reputation) * growthFactor(day);
  return DEMAND.baseProfile.map((rate, time) => ({ time, rate: rate * factor }));
}
