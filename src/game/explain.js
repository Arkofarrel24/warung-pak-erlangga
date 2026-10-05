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
 *   idle        utilization ρ: the share of paid time spent serving
 *   reneging    Erlang-A: expected reneges = θ x total time spent waiting
 *   blocking    M/M/c/K: arrivals that find all K places taken
 *   little      Little's law, Lq = λ x Wq, shown with the day's numbers
 *   stock       the newsvendor's two costs: a portion short, a portion over
 *   breakEven   the sales needed to cover the day's costs
 *
 * The findings are ordered by what they cost the day in rupiah, so the first
 * one is the place to look.
 */

import { DAY } from './config.js';

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
 * Paid time in which nobody was served.
 *
 * Utilization ρ = busy time / staffed time. A low ρ is not a fault in
 * itself (some slack is what keeps waits short), but it has a price: the
 * wages of the idle share.
 */
function idle(report, hours) {
  const { rho } = report.results;
  const quiet = hours.filter((item) => item.rho < 0.4).map((item) => item.hour);
  if (rho >= 0.6 || quiet.length === 0) return null;
  return {
    id: 'idle',
    rho,
    quietHours: quiet,
    cost: (1 - rho) * report.ledger.wages,
  };
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
 * included.
 */
function breakEven(report) {
  const { ledger, decisions, results } = report;
  const costs = ledger.ingredients + ledger.wages + ledger.rent;
  return {
    id: 'breakEven',
    costs,
    needed: costs / decisions.price,
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
    little(report),
    breakEven(report),
  ].filter(Boolean);
  return findings.sort((a, b) => b.cost - a.cost);
}
