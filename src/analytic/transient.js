/**
 * Transient analysis of one day: the exact expected course of a queue whose
 * arrival rate and number of servers change over time.
 *
 * The steady-state formulas in formulas.js assume the system has been running
 * unchanged for a very long time. A warung day is the opposite: it opens
 * empty, the arrival rate never stops moving, and it closes after a few
 * hours. For that case there is no closed formula, but the model is still a
 * continuous-time Markov chain (CTMC), because every time in it is
 * exponential. Its state probabilities obey the Kolmogorov forward equations,
 *
 *   dp/dt = p(t) · Q(t)
 *
 * where Q(t) holds the rates of moving from one state to another at time t.
 * This file solves that system of differential equations numerically.
 *
 * The state is the pair (q, b): q customers waiting and b servers busy. With
 * λ = λ(t) and c = c(t) servers on duty, the moves out of a state are
 *
 *   arrival       rate λ     b + 1 when b < c (a server is free)
 *                            q + 1 when the servers are busy and q < seats
 *                            nothing when q = seats: the customer balks
 *   service ends  rate b·μ   q - 1 when someone waits and b <= c (the server
 *                            calls the next customer, so b stays the same)
 *                            b - 1 otherwise
 *   reneging      rate q·θ   q - 1
 *
 * With a fixed c the state could be the single number n = q + b, an ordinary
 * birth-death process. The pair is needed for one reason: after a cut in
 * staff, more servers may still be busy than are on duty (b > c) until they
 * finish the customer in hand. These rules are the simulation engine's rules,
 * so the result is the exact expectation of what the engine produces, which
 * is what makes it usable to validate the engine and to balance the game.
 *
 * Any time unit works as long as it is used consistently.
 */

import { ArrivalProfile } from '../sim/arrival-profile.js';

/**
 * @typedef {object} DayModel
 * @property {number} [arrivalRate]  λ, constant
 * @property {{ time: number, rate: number }[]} [arrivalProfile]  λ(t)
 * @property {number} serviceRate    μ
 * @property {number} [servers]      c, constant
 * @property {{ time: number, servers: number }[]} [staffSchedule]  c(t)
 * @property {number} waitingRoom    number of waiting seats, K - c. Must be
 *   finite: the state space has to be finite to be solved.
 * @property {number} [patienceRate] θ; 0 = customers never give up
 * @property {number} closingTime    arrivals stop here; the line is then cleared
 * @property {number} [periodLength] also report per period of this length
 */

/**
 * @param {DayModel} model
 * @param {object} [options]
 * @param {number} [options.safety] the step size is `safety` divided by the
 *   fastest rate out of any state. Smaller is more accurate and slower.
 * @param {number} [options.drainTolerance] after closing, stop once the
 *   probability that anyone is still inside drops below this
 * @param {number} [options.maxDrain] and never look further than this long
 *   after closing
 */
export function solveDay(model, { safety = 0.5, drainTolerance = 1e-9, maxDrain = 100 } = {}) {
  const { serviceRate, patienceRate = 0, closingTime, periodLength, waitingRoom } = model;
  const profile = new ArrivalProfile(
    model.arrivalProfile ?? [{ time: 0, rate: model.arrivalRate }],
  );
  const schedule = model.staffSchedule ?? [{ time: 0, servers: model.servers ?? 1 }];
  const maxServers = Math.max(...schedule.map((entry) => entry.servers));

  if (!Number.isInteger(waitingRoom) || waitingRoom < 0) {
    throw new RangeError('The transient solver needs a finite waiting room.');
  }
  if (!(closingTime > 0)) throw new RangeError('Closing time must be a positive number.');

  // State (q, b) lives at index q·stride + b. After the probabilities come
  // five running integrals, solved along with them as extra equations.
  const stride = maxServers + 1;
  const stateCount = (waitingRoom + 1) * stride;
  const QUEUE = stateCount; //     ∫ E[q] dt          customer-time spent waiting
  const BUSY = stateCount + 1; //  ∫ E[b] dt          server-time spent serving
  const BLOCKED = stateCount + 2; // ∫ λ·P(full) dt   expected number who balk
  const NOT_EMPTY = stateCount + 3; // ∫ P(someone inside) dt
  const PRESENT = stateCount + 4; // ∫ E[max(c, b)] dt  server-time at their post
  const size = stateCount + 5;

  // After closing, the day is over as soon as the place is empty, so from
  // then on the empty state counts as "everyone has gone home".
  let closed = false;

  /** dy/dt for the probabilities and the five integrals. */
  function derivative(y, arrivalRate, staff, out) {
    out.fill(0);
    let meanQueue = 0;
    let meanBusy = 0;
    let meanPresent = closed ? -staff * y[0] : 0;
    let full = 0;

    for (let q = 0; q <= waitingRoom; q++) {
      for (let b = 0; b <= maxServers; b++) {
        const i = q * stride + b;
        const p = y[i];
        if (p === 0) continue;
        meanQueue += q * p;
        meanBusy += b * p;
        meanPresent += Math.max(staff, b) * p;

        // Arrival
        if (b < staff && b < maxServers) {
          out[i] -= arrivalRate * p;
          out[i + 1] += arrivalRate * p;
        } else if (q < waitingRoom) {
          out[i] -= arrivalRate * p;
          out[i + stride] += arrivalRate * p;
        } else {
          full += p;
        }

        // Service completion
        if (b > 0) {
          const flow = b * serviceRate * p;
          out[i] -= flow;
          out[q > 0 && b <= staff ? i - stride : i - 1] += flow;
        }

        // Reneging
        if (q > 0 && patienceRate > 0) {
          const flow = q * patienceRate * p;
          out[i] -= flow;
          out[i - stride] += flow;
        }
      }
    }

    out[QUEUE] = meanQueue;
    out[BUSY] = meanBusy;
    out[BLOCKED] = arrivalRate * full;
    out[NOT_EMPTY] = 1 - y[0];
    out[PRESENT] = meanPresent;
  }

  // The classical fourth-order Runge-Kutta method (RK4). It is stable only
  // while the step is short compared with the fastest change in the system,
  // so the step follows the largest total rate out of any state.
  const fastestRate =
    profile.maxRate + maxServers * serviceRate + waitingRoom * patienceRate;
  const maxStep = safety / fastestRate;
  const k1 = new Float64Array(size);
  const k2 = new Float64Array(size);
  const k3 = new Float64Array(size);
  const k4 = new Float64Array(size);
  const trial = new Float64Array(size);

  /**
   * Advances y from t0 to t1. Within the interval the staff is constant and
   * the arrival rate runs in a straight line from rate0 to rate1.
   */
  function integrate(y, t0, t1, rate0, rate1, staff) {
    const steps = Math.max(1, Math.ceil((t1 - t0) / maxStep));
    const h = (t1 - t0) / steps;
    for (let s = 0; s < steps; s++) {
      const rateStart = rate0 + ((rate1 - rate0) * s) / steps;
      const rateMiddle = rate0 + ((rate1 - rate0) * (s + 0.5)) / steps;
      const rateEnd = rate0 + ((rate1 - rate0) * (s + 1)) / steps;

      derivative(y, rateStart, staff, k1);
      for (let i = 0; i < size; i++) trial[i] = y[i] + (h / 2) * k1[i];
      derivative(trial, rateMiddle, staff, k2);
      for (let i = 0; i < size; i++) trial[i] = y[i] + (h / 2) * k2[i];
      derivative(trial, rateMiddle, staff, k3);
      for (let i = 0; i < size; i++) trial[i] = y[i] + h * k3[i];
      derivative(trial, rateEnd, staff, k4);
      for (let i = 0; i < size; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
  }

  /**
   * When staff come on duty, each of them calls a waiting customer at once:
   * probability moves from (q, b) to (q - m, b + m) with m = min(q, c - b).
   * A cut in staff moves nothing, because nobody in service is interrupted.
   */
  function applyStaffChange(y, staff) {
    const moved = new Float64Array(stateCount);
    for (let q = 0; q <= waitingRoom; q++) {
      for (let b = 0; b <= maxServers; b++) {
        const m = Math.max(0, Math.min(q, staff - b));
        moved[(q - m) * stride + b + m] += y[q * stride + b];
      }
    }
    y.set(moved);
  }

  function moments(y) {
    let queue = 0;
    let busy = 0;
    let full = 0;
    for (let q = 0; q <= waitingRoom; q++) {
      for (let b = 0; b <= maxServers; b++) {
        const p = y[q * stride + b];
        queue += q * p;
        busy += b * p;
      }
    }
    for (let b = 0; b <= maxServers; b++) full += y[waitingRoom * stride + b];
    return {
      meanQueue: queue,
      meanBusy: busy,
      meanInSystem: queue + busy,
      emptyProbability: y[0],
      // Probability that every waiting seat is taken.
      fullProbability: full,
    };
  }

  // --- Opening hours ---------------------------------------------------------

  const staffChanges = new Map(schedule.slice(1).map((entry) => [entry.time, entry.servers]));
  const periodEnds = new Set();
  if (periodLength !== undefined) {
    for (let k = 1; k * periodLength <= closingTime; k++) periodEnds.add(k * periodLength);
  }
  // The solver never steps across a point where λ(t) bends or c(t) jumps.
  const stops = [
    ...new Set([
      ...profile.breakpoints.filter((time) => time > 0 && time < closingTime),
      ...[...staffChanges.keys()].filter((time) => time <= closingTime),
      ...periodEnds,
      closingTime,
    ]),
  ].sort((a, b) => a - b);

  const y = new Float64Array(size);
  y[0] = 1; // The day starts empty: state (0, 0) with certainty.
  let staff = schedule[0].servers;
  let time = 0;

  const periods = [];
  let periodStart = 0;
  // Scheduled server time during opening hours, ∫ c(t) dt.
  let scheduledTime = 0;
  let snapshot = { queue: 0, busy: 0, blocked: 0, present: 0, scheduled: 0 };
  function closePeriod(to) {
    const length = to - periodStart;
    const totalQueueTime = y[QUEUE] - snapshot.queue;
    const totalBusyTime = y[BUSY] - snapshot.busy;
    const totalStaffedTime = y[PRESENT] - snapshot.present;
    const scheduled = scheduledTime - snapshot.scheduled;
    const arrivals = profile.expectedArrivals(periodStart, Math.min(to, closingTime));
    periods.push({
      from: periodStart,
      to,
      arrivals,
      rejected: y[BLOCKED] - snapshot.blocked,
      reneged: patienceRate * totalQueueTime,
      served: serviceRate * totalBusyTime,
      rho: totalBusyTime / totalStaffedTime,
      // Offered load of the period: work arriving / work the scheduled staff
      // can do, Λ / (μ·∫c dt). Above 1 the line must grow, whatever the day's
      // average says. Undefined after closing, when nothing arrives.
      trafficIntensity: scheduled > 0 ? arrivals / (serviceRate * scheduled) : NaN,
      Lq: totalQueueTime / length,
      totalQueueTime,
      totalBusyTime,
      totalStaffedTime,
    });
    periodStart = to;
    snapshot = {
      queue: y[QUEUE],
      busy: y[BUSY],
      blocked: y[BLOCKED],
      present: y[PRESENT],
      scheduled: scheduledTime,
    };
  }

  for (const stop of stops) {
    integrate(y, time, stop, profile.rateAt(time), profile.rateBefore(stop), staff);
    scheduledTime += staff * (stop - time);
    time = stop;
    if (periodEnds.has(stop)) closePeriod(stop);
    if (staffChanges.has(stop)) {
      staff = staffChanges.get(stop);
      applyStaffChange(y, staff);
    }
  }
  const atClose = moments(y);
  const notEmptyAtClose = y[NOT_EMPTY];
  closed = true;

  // --- After closing: nobody arrives, the customers inside are cleared -------

  const laterChanges = [...staffChanges.keys()].filter((t) => t > closingTime).sort((a, b) => a - b);
  const drainLimit = closingTime + maxDrain;
  while (1 - y[0] > drainTolerance && time < drainLimit) {
    const nextPeriodEnd =
      periodLength === undefined ? Infinity : (Math.floor(time / periodLength + 1e-9) + 1) * periodLength;
    const nextChange = laterChanges.find((t) => t > time) ?? Infinity;
    const stop = Math.min(nextPeriodEnd, nextChange, time + 1 / serviceRate, drainLimit);
    integrate(y, time, stop, 0, 0, staff);
    time = stop;
    if (stop === nextPeriodEnd) closePeriod(stop);
    if (stop === nextChange) {
      staff = staffChanges.get(stop);
      applyStaffChange(y, staff);
    }
  }
  if (periodLength !== undefined && time > periodStart) closePeriod(time);

  const arrivals = profile.expectedArrivals(0, closingTime);
  return {
    arrivals,
    // Expected numbers of customers by how their visit ends.
    rejected: y[BLOCKED],
    reneged: patienceRate * y[QUEUE],
    served: serviceRate * y[BUSY],
    totalQueueTime: y[QUEUE],
    totalBusyTime: y[BUSY],
    // Server time at their post, from opening until the last customer leaves.
    totalStaffedTime: y[PRESENT],
    // Server time scheduled during opening hours, ∫ c(t) dt.
    scheduledStaffTime: scheduledTime,
    // Mean time in line over everyone who got in (Little's law over the day).
    WqAll: y[QUEUE] / (arrivals - y[BLOCKED]),
    // Expected time from closing until the last customer has left:
    // E[T] = ∫ P(T > t) dt.
    overtime: y[NOT_EMPTY] - notEmptyAtClose,
    // Probability that someone is still inside when the solver stops. Above
    // the tolerance only when the line cannot clear (no staff, no reneging).
    unresolved: 1 - y[0],
    atClose,
    periods,
  };
}
