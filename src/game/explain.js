/**
 * Why a day went the way it did, in the terms of queueing theory.
 *
 * Every finding here is read off the day's own report and tied to one
 * concept. Nothing is simulated again and nothing is guessed: a finding is a
 * quantity the theory defines, computed from what the simulation measured,
 * together with the numbers that went into it, so that the sentence built
 * from it on screen can be checked by hand.
 *
 *   overload    traffic intensity a = λ / (c·μ) above 1 in some hour
 *   idle        hours in which one pegawai fewer would still have kept a at or under 1
 *   price       the day's lost customers against what a price step keeps away or brings
 *   reneging    Erlang-A: expected reneges = θ x total time spent waiting
 *   blocking    M/M/c/K: arrivals that find all K places taken
 *   little      Little's law, Lq = λ x Wq, shown with the day's numbers
 *   stock       the newsvendor's two costs: a portion short, a portion over
 *   breakEven   the sales needed to cover the day's costs
 *
 * The findings are ordered by what they cost the day in rupiah, so the first
 * one is the place to look.
 */

import { DAY, DEMAND, LIMITS } from './config.js';

const sum = (values) => values.reduce((total, value) => total + value, 0);

/** The hours the warung was open, each with its capacity c·μ. */
function openHours(report) {
  const { serviceRate } = report.setup;
  return report.results.periods.slice(0, DAY.hours).map((period, hour) => ({
    hour,
    arrivals: period.arrivals,
    reneged: period.reneged,
    rejected: period.rejected,
    rho: period.rho,
    staff: period.staff,
    // Capacity: the most customers c pegawai can serve in the hour.
    capacity: period.staff * serviceRate,
  }));
}

/**
 * Hours in which more customers came than could be served.
 *
 * Traffic intensity a = λ / (c·μ). While a > 1 a queue grows without limit;
 * here the excess cannot pile up for long, because waiting customers give up
 * and a full warung turns arrivals away. So an overloaded hour shows as
 * customers lost in that hour.
 */
function overload(hours, margin) {
  const over = hours.filter((item) => item.arrivals > item.capacity);
  if (over.length === 0) return null;
  const worst = over.reduce((top, item) => (item.arrivals / item.capacity > top.arrivals / top.capacity ? item : top));
  const lost = sum(over.map((item) => item.reneged + item.rejected));
  return {
    id: 'overload',
    hours: over.map((item) => item.hour),
    worst: { ...worst, intensity: worst.arrivals / worst.capacity },
    lost,
    cost: lost * margin,
  };
}

/**
 * Hours in which one pegawai fewer would still have been enough.
 *
 * Utilization ρ below 1 is not a fault in itself: some slack is what keeps
 * waits short. A pegawai is only counted as idle where they could have been
 * spared: in an hour with more than the fewest a warung can have, in which
 * one fewer would still have kept the traffic intensity a = λ ÷ (c·μ) at or
 * under 1. What it cost is that pegawai's wage for those hours.
 */
function idle(report, hours) {
  const { serviceRate, wagePerHour } = report.setup;
  const spare = hours.filter((item) => item.staff > LIMITS.staff.min && item.arrivals <= (item.staff - 1) * serviceRate);
  if (spare.length === 0) return null;
  return {
    id: 'idle',
    rho: report.results.rho,
    hours: spare.map((item) => item.hour),
    // Every open hour: one pegawai fewer all day, which needs no shift board.
    allDay: spare.length === hours.length,
    // Whether the day was already scheduled per shift.
    scheduled: Boolean(report.decisions.shifts),
    cost: spare.length * wagePerHour,
  };
}

/**
 * The price against the queue, read off the day's own counts.
 *
 * Demand is exponential in the price, so a step of Rp 1,000 up keeps away
 * the share 1 - e^(-1,000/s) of those who came, and a step down brings
 * e^(1,000/s) - 1 more. Two cases follow from the day:
 *
 *   too low   more customers were lost to the queue (reneging and balking)
 *             than a step up would have kept away. Those sales were lost
 *             either way, so about as many would have been served, each
 *             for Rp 1,000 more.
 *   too high  nobody was lost, nothing ran out, and the counter had room
 *             in every hour for the customers a step down would have brought.
 *
 * Both are first-order estimates from one day, not a second simulation.
 */
function price(report, hours, margin) {
  const { arrivals, served, reneged, rejected, soldOut } = report.results;
  const step = 1_000;
  const dearer = 1 - Math.exp(-step / DEMAND.priceSensitivity);
  const cheaper = Math.exp(step / DEMAND.priceSensitivity) - 1;
  const lost = reneged + rejected;

  if (served > 0 && lost >= arrivals * dearer && report.decisions.price + step <= LIMITS.price.max) {
    return { id: 'price', kind: 'low', step, share: dearer, keptAway: arrivals * dearer, lost, served, cost: served * step };
  }
  const roomEveryHour = hours.every((item) => item.arrivals * (1 + cheaper) <= item.capacity);
  const gain = arrivals * cheaper * (margin - step) - served * step;
  if (lost === 0 && soldOut === 0 && roomEveryHour && gain > 0 && report.decisions.price - step >= LIMITS.price.min) {
    return { id: 'price', kind: 'high', step, share: cheaper, more: arrivals * cheaper, served, margin: margin - step, cost: gain };
  }
  return null;
}

/**
 * Customers who gave up waiting.
 *
 * In the Erlang-A model each waiting customer gives up at rate θ, so the
 * expected number of reneges is θ times the total time all customers spent
 * in the queue. The day's count is one draw around that expectation.
 */
function reneging(report, margin) {
  const { reneged, totalQueueTime, WqReneged } = report.results;
  if (reneged === 0) return null;
  const { patienceRate } = report.setup;
  return {
    id: 'reneging',
    reneged,
    patienceRate,
    meanPatience: 1 / patienceRate,
    totalQueueTime,
    expected: patienceRate * totalQueueTime,
    waitedBeforeLeaving: WqReneged,
    cost: reneged * margin,
  };
}

/**
 * Customers who found no place to wait.
 *
 * A system with K places (c being served and K - c waiting) turns away
 * whoever arrives while all K are taken. The share turned away is the
 * blocking probability of the day.
 */
function blocking(report, hours, margin) {
  const { rejected, arrivals } = report.results;
  if (rejected === 0) return null;
  const servers = Math.max(...hours.map((item) => item.staff));
  return {
    id: 'blocking',
    rejected,
    share: rejected / arrivals,
    servers,
    seats: report.setup.seats,
    places: servers + report.setup.seats,
    cost: rejected * margin,
  };
}

/**
 * Little's law for the queue: Lq = λ x Wq.
 *
 * The mean number waiting equals the rate at which customers join the system
 * times the mean time each of them waits. It holds for any queue, and here
 * exactly, because all three are measured over the same day: λ counts those
 * who got in, and Wq is the wait of all of them, served or not.
 */
function little(report) {
  const { Lq, WqAll, arrivals, rejected, soldOutAtDoor, observedTime } = report.results;
  const entered = arrivals - rejected - soldOutAtDoor;
  if (entered === 0 || WqAll === null) return null;
  return {
    id: 'little',
    Lq,
    rate: entered / observedTime,
    wait: WqAll,
    entered,
    cost: 0,
  };
}

/**
 * Too little prepared, or too much.
 *
 * The newsvendor's two costs: a portion short loses its margin, a portion
 * over loses what its ingredients cost. The best stock balances the two.
 */
function stock(report, margin) {
  const { soldOut, soldOutAt, stockLeft } = report.results;
  const perPortion = report.setup.ingredientCost;
  if (soldOut > 0) {
    return { id: 'stock', kind: 'short', portions: soldOut, soldOutAt, each: margin, cost: soldOut * margin };
  }
  if (stockLeft > 0) {
    return { id: 'stock', kind: 'over', portions: stockLeft, each: perPortion, cost: stockLeft * perPortion };
  }
  return null;
}

/**
 * The break-even point of the day: the portions that had to be sold for
 * revenue to cover everything paid, the ingredients of unsold portions
 * included. Tips picked up from the counter have already covered a little
 * of it, so that selling exactly this many leaves a profit of zero.
 */
function breakEven(report) {
  const { ledger, decisions, results } = report;
  const costs = ledger.ingredients + ledger.wages + ledger.rent;
  // A day saved before tips existed has none.
  const tips = ledger.tips ?? 0;
  return {
    id: 'breakEven',
    costs,
    tips,
    needed: Math.max(costs - tips, 0) / decisions.price,
    sold: results.served,
    cost: 0,
  };
}

/**
 * @param {object} report a day's report, as playDay() returns it
 * @returns {object[]} the findings that apply, the costliest first; those
 *   that only describe (Little's law, the break-even point) come last
 */
export function explainDay(report) {
  // What one more customer served would have been worth.
  const margin = report.decisions.price - report.setup.ingredientCost;
  const hours = openHours(report);
  const findings = [
    overload(hours, margin),
    reneging(report, margin),
    blocking(report, hours, margin),
    stock(report, margin),
    idle(report, hours),
    price(report, hours, margin),
    little(report),
    breakEven(report),
  ].filter(Boolean);
  return findings.sort((a, b) => b.cost - a.cost);
}
