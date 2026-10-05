/**
 * Steady-state analytic formulas for Markovian queues: M/M/1, M/M/c, M/M/c/K,
 * and M/M/c/K+M (customers who give up waiting).
 *
 * Notation used throughout this file:
 *   λ   arrival rate
 *   μ   service rate of one server
 *   c   number of servers
 *   K   system capacity (those waiting + those in service)
 *   a   = λ/μ, the offered load, measured in Erlangs
 *   ρ   = λ/(cμ), the traffic intensity. As long as ρ < 1 it equals the
 *       server utilization.
 *   θ   rate at which a waiting customer gives up; mean patience is 1/θ
 *   p_n probability that exactly n customers are in the system
 *
 * Every formula assumes the system has been running for a very long time.
 * They do not describe the first hours after a system opens empty; that is
 * why the simulation needs a warm-up period before the two are compared.
 *
 * The time unit follows the unit of the rates: rates per hour give W and Wq
 * in hours.
 */

import { DISCIPLINE } from '../sim/waiting-line.js';

/**
 * M/M/1: one server, unlimited queue.
 *
 *   ρ  = λ/μ
 *   P0 = 1 - ρ
 *   L  = ρ / (1 - ρ)
 *   Lq = ρ² / (1 - ρ)
 *   W  = 1 / (μ - λ)
 *   Wq = ρ / (μ - λ)
 *
 * These follow from p_n = (1 - ρ)·ρⁿ, a geometric distribution.
 */
export function mm1(arrivalRate, serviceRate) {
  const rho = arrivalRate / serviceRate;
  if (rho >= 1) return unstable('M/M/1', arrivalRate, rho);

  return {
    model: 'M/M/1',
    stable: true,
    trafficIntensity: rho,
    rho,
    P0: 1 - rho,
    L: rho / (1 - rho),
    Lq: (rho * rho) / (1 - rho),
    W: 1 / (serviceRate - arrivalRate),
    Wq: rho / (serviceRate - arrivalRate),
    // A customer waits when the server is busy, which happens a share ρ of the time.
    waitProbability: rho,
    blockingProbability: 0,
    effectiveArrivalRate: arrivalRate,
    // Waiting-time distribution of M/M/1 FIFO: P(Wq > t) = ρ·e^(-(μ - λ)t)
    waitTail: (t) => rho * Math.exp(-(serviceRate - arrivalRate) * t),
  };
}

/**
 * P0 and the probability of waiting for M/M/c.
 *
 *   P0 = 1 / [ Σ(n=0..c-1) aⁿ/n!  +  aᶜ / (c!·(1 - ρ)) ]
 *
 * The Erlang C formula, the probability that an arriving customer finds all
 * servers busy and therefore has to wait:
 *
 *   C(c, a) = [ aᶜ / (c!·(1 - ρ)) ] · P0
 */
function erlangTerms(servers, offeredLoad) {
  const rho = offeredLoad / servers;
  // The terms aⁿ/n! are computed as a chain, term(n) = term(n-1)·a/n, so that
  // large powers and factorials never have to be computed separately.
  let term = 1;
  let sum = 0;
  for (let n = 0; n < servers; n++) {
    sum += term;
    term *= offeredLoad / (n + 1);
  }
  // After the loop, term = aᶜ/c!
  const allBusy = term / (1 - rho);
  return { P0: 1 / (sum + allBusy), waitProbability: allBusy / (sum + allBusy) };
}

/** The Erlang C formula. Returns 1 when ρ >= 1 (every customer has to wait). */
export function erlangC(servers, offeredLoad) {
  if (offeredLoad / servers >= 1) return 1;
  return erlangTerms(servers, offeredLoad).waitProbability;
}

/**
 * M/M/c: c identical servers, unlimited queue.
 *
 *   Lq = C(c, a) · ρ / (1 - ρ)
 *   Wq = Lq / λ            (Little's law)
 *   W  = Wq + 1/μ          (wait, then get served)
 *   L  = λ·W = Lq + a      (Little's law)
 */
export function mmc(arrivalRate, serviceRate, servers) {
  const offeredLoad = arrivalRate / serviceRate;
  const rho = offeredLoad / servers;
  if (rho >= 1) return unstable('M/M/c', arrivalRate, rho);

  const { P0, waitProbability } = erlangTerms(servers, offeredLoad);
  const Lq = (waitProbability * rho) / (1 - rho);
  const Wq = Lq / arrivalRate;
  const W = Wq + 1 / serviceRate;

  return {
    model: 'M/M/c',
    stable: true,
    trafficIntensity: rho,
    rho,
    P0,
    L: arrivalRate * W,
    Lq,
    W,
    Wq,
    waitProbability,
    blockingProbability: 0,
    effectiveArrivalRate: arrivalRate,
    // Waiting-time distribution of M/M/c FIFO: P(Wq > t) = C(c, a)·e^(-(cμ - λ)t)
    waitTail: (t) =>
      waitProbability * Math.exp(-(servers * serviceRate - arrivalRate) * t),
  };
}

/**
 * State probabilities p_0..p_K of M/M/c/K, from the balance equations of a
 * birth-death process:
 *
 *   p_n = p_(n-1) · λ / (min(n, c)·μ)
 *
 * which expands into the textbook formulas:
 *
 *   p_n = p_0 · aⁿ / n!                  for n <= c
 *   p_n = p_0 · aⁿ / (c!·c^(n-c))        for c <= n <= K
 *
 * and then p_0 is chosen so that all probabilities add up to 1.
 *
 * The computation is done on a logarithmic scale. When λ is far larger than
 * cμ and K is large, the weights aⁿ exceed the floating-point range; their
 * logarithms do not.
 */
function stateProbabilities(offeredLoad, servers, capacity) {
  const logWeights = new Array(capacity + 1);
  logWeights[0] = 0;
  for (let n = 1; n <= capacity; n++) {
    logWeights[n] = logWeights[n - 1] + Math.log(offeredLoad / Math.min(n, servers));
  }
  const largest = Math.max(...logWeights);
  const weights = logWeights.map((logWeight) => Math.exp(logWeight - largest));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

/**
 * M/M/c/K: c servers, at most K customers in the system. A customer who
 * arrives when the system is full is turned away.
 *
 *   P_K   = p_K                  probability of being rejected
 *   λ_eff = λ·(1 - P_K)          rate of customers who actually get in
 *   L     = Σ n·p_n
 *   Lq    = Σ (n - c)·p_n        for n > c
 *   W     = L / λ_eff            (Little's law with the effective λ)
 *   Wq    = Lq / λ_eff
 *   ρ     = λ_eff / (cμ)         server utilization
 *
 * "Probability of rejection = p_K" relies on the PASTA property (Poisson
 * Arrivals See Time Averages): Poisson customers see the system exactly as it
 * is on average over time, so the share of customers who find it full equals
 * the share of time it is full.
 *
 * This system is always stable, even when λ >= cμ, because the queue cannot
 * exceed K - c.
 */
export function mmck(arrivalRate, serviceRate, servers, capacity) {
  const offeredLoad = arrivalRate / serviceRate;
  const p = stateProbabilities(offeredLoad, servers, capacity);

  let L = 0;
  let Lq = 0;
  for (let n = 0; n <= capacity; n++) {
    L += n * p[n];
    if (n > servers) Lq += (n - servers) * p[n];
  }
  const blockingProbability = p[capacity];
  const effectiveArrivalRate = arrivalRate * (1 - blockingProbability);

  // State distribution seen by ACCEPTED customers: q_n = p_n / (1 - P_K).
  const seenByAccepted = p.slice(0, capacity).map((pn) => pn / (1 - blockingProbability));
  const waitProbability = seenByAccepted.slice(servers).reduce((sum, qn) => sum + qn, 0);

  return {
    model: 'M/M/c/K',
    stable: true,
    trafficIntensity: offeredLoad / servers,
    rho: effectiveArrivalRate / (servers * serviceRate),
    P0: p[0],
    L,
    Lq,
    W: L / effectiveArrivalRate,
    Wq: Lq / effectiveArrivalRate,
    waitProbability,
    blockingProbability,
    effectiveArrivalRate,
    waitTail: (t) => erlangMixtureTail(seenByAccepted, servers, servers * serviceRate * t),
  };
}

/**
 * P(Wq > t) for M/M/c/K FIFO.
 *
 * A customer who arrives when n >= c customers are present has to wait for
 * n - c + 1 departures. While all servers are busy, departures happen at rate
 * cμ, so the wait follows an Erlang(n - c + 1, cμ) distribution, whose tail is
 *
 *   P(Erlang(k, θ) > t) = Σ(j=0..k-1) e^(-θt)·(θt)^j / j!
 *
 * @param {number[]} seenByAccepted q_0..q_(K-1)
 * @param {number} servers          c
 * @param {number} x                θt = cμt
 */
function erlangMixtureTail(seenByAccepted, servers, x) {
  let poisson = Math.exp(-x);
  let cumulative = 0;
  let tail = 0;
  for (let n = servers; n < seenByAccepted.length; n++) {
    const j = n - servers;
    if (j > 0) poisson *= x / j;
    cumulative += poisson;
    tail += seenByAccepted[n] * cumulative;
  }
  return tail;
}

/**
 * State probabilities of a birth-death process whose death rate depends on
 * the state in any way:
 *
 *   p_n = p_(n-1) · λ / δ_n
 *
 * where δ_n is the total rate at which customers leave when n are present.
 * This is the same balance equation as in stateProbabilities() above, with
 * min(n, c)·μ replaced by a general δ_n.
 *
 * With an unlimited capacity the list is cut off where the remaining states
 * carry no weight worth counting. That only works when δ_n keeps growing with
 * n, which reneging guarantees.
 *
 * @param {(n: number) => number} deathRateAt δ_n
 */
function birthDeathProbabilities(arrivalRate, deathRateAt, capacity) {
  const NEGLIGIBLE = -40; // e^-40 is about 4·10^-18 of the largest weight
  const logWeights = [0];
  let largest = 0;
  for (let n = 1; n <= capacity; n++) {
    const logWeight = logWeights[n - 1] + Math.log(arrivalRate / deathRateAt(n));
    const fading = logWeight < logWeights[n - 1];
    if (capacity === Infinity && fading && logWeight < largest + NEGLIGIBLE) break;
    logWeights.push(logWeight);
    if (logWeight > largest) largest = logWeight;
  }
  const weights = logWeights.map((logWeight) => Math.exp(logWeight - largest));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

/**
 * M/M/c/K+M: c servers, at most K customers in the system, and customers who
 * give up waiting (reneging). Without the limit K it is the Erlang-A model
 * (Palm, 1943); the "A" stands for abandonment.
 *
 * Each waiting customer has an exponentially distributed patience with mean
 * 1/θ. While n > c customers are present, n - c of them are waiting and each
 * leaves at rate θ, on top of the c services in progress. So the system is
 * still a birth-death process, with death rate
 *
 *   δ_n = min(n, c)·μ + max(n - c, 0)·θ
 *
 * and its state probabilities follow from p_n = p_(n-1) · λ / δ_n.
 *
 *   P_K        = p_K                   probability of balking (turned away)
 *   λ_eff      = λ·(1 - P_K)           rate of customers who get in
 *   Lq         = Σ (n - c)·p_n         for n > c
 *   reneging   = θ·Lq                  customers lost per unit of time: on
 *                                      average Lq are waiting, each leaving
 *                                      at rate θ
 *   throughput = μ·E[busy servers]     customers served per unit of time
 *
 * Everyone who arrives is turned away, gives up, or is served, so
 * λ = λ·P_K + θ·Lq + throughput (flow conservation).
 *
 * This system is always stable, even when λ >= cμ and K is unlimited: the
 * longer the line, the faster it loses customers.
 *
 * W and Wq here average over every customer who got in, including those who
 * gave up (for them the time in the system is only their time in line). That
 * is the average Little's law speaks about: L = λ_eff·W and Lq = λ_eff·Wq.
 */
export function mmckm(arrivalRate, serviceRate, servers, capacity, patienceRate) {
  const deathRateAt = (n) =>
    Math.min(n, servers) * serviceRate + Math.max(n - servers, 0) * patienceRate;
  const p = birthDeathProbabilities(arrivalRate, deathRateAt, capacity);

  let L = 0;
  let Lq = 0;
  let busy = 0;
  let allBusy = 0;
  p.forEach((pn, n) => {
    L += n * pn;
    Lq += Math.max(n - servers, 0) * pn;
    busy += Math.min(n, servers) * pn;
    if (n >= servers) allBusy += pn;
  });
  const blockingProbability = capacity === Infinity ? 0 : p[capacity];
  const effectiveArrivalRate = arrivalRate * (1 - blockingProbability);
  const abandonmentRate = patienceRate * Lq;

  return {
    model: capacity === Infinity ? 'M/M/c+M' : 'M/M/c/K+M',
    stable: true,
    trafficIntensity: arrivalRate / (servers * serviceRate),
    // Utilization: the mean share of servers that are busy.
    rho: busy / servers,
    P0: p[0],
    L,
    Lq,
    W: L / effectiveArrivalRate,
    Wq: Lq / effectiveArrivalRate,
    // An accepted customer waits when all servers are busy but the system is
    // not full (PASTA, restricted to the customers who get in).
    waitProbability: (allBusy - blockingProbability) / (1 - blockingProbability),
    blockingProbability,
    effectiveArrivalRate,
    abandonmentRate,
    // Share of ALL arriving customers who end up giving up.
    renegeProbability: abandonmentRate / arrivalRate,
    throughput: serviceRate * busy,
  };
}

/**
 * Cobham's non-preemptive priority formula (1954) for two classes with equal
 * service rates, on M/M/c:
 *
 *   Wq_k = W0 / [ (1 - σ_(k-1)) · (1 - σ_k) ]
 *
 *   σ_k = (λ_1 + ... + λ_k) / (cμ)     load of classes 1 through k; σ_0 = 0
 *   W0  = C(c, a) / (cμ)               mean time until a server becomes free:
 *                                      the probability that all servers are
 *                                      busy (Erlang C) times the mean time to
 *                                      the next departure, 1/(cμ)
 *
 * Class 1 (priority) is held up only by other class-1 customers, whereas
 * class 2 (regular) is held up by everyone, so its denominator contains
 * (1 - ρ). The weighted average of the two classes always comes back to the
 * FIFO Wq; priority only moves waiting time from one class to the other.
 *
 * @returns {[number, number]} [Wq of the priority class, Wq of the regular class]
 */
export function priorityWaits(arrivalRate, serviceRate, servers, priorityShare) {
  const offeredLoad = arrivalRate / serviceRate;
  const rho = offeredLoad / servers;
  if (rho >= 1) return [Infinity, Infinity];

  const meanResidual = erlangC(servers, offeredLoad) / (servers * serviceRate);
  const highLoad = priorityShare * rho;
  const high = meanResidual / (1 - highLoad);
  const regular = meanResidual / ((1 - highLoad) * (1 - rho));
  return [high, regular];
}

/**
 * Picks the model that matches the configuration and computes every metric.
 *
 * The averages L, Lq, W, and Wq do not depend on the queue discipline as long
 * as the discipline ignores service times and never interrupts a service in
 * progress. FIFO, LIFO, and non-preemptive priority all qualify, so the three
 * share the same formulas. What differs is the distribution of waiting times;
 * `waitTail` holds for FIFO only.
 *
 * @param {import('../sim/engine.js').SimulationConfig} config
 */
export function analyze(config) {
  const { arrivalRate, serviceRate, servers = 1, patienceRate = 0 } = config;
  // The capacity may be given as K or as the number of waiting seats, K - c.
  const capacity =
    config.waitingRoom === undefined ? (config.capacity ?? Infinity) : servers + config.waitingRoom;

  // With reneging there is no waitTail and no per-class formula.
  if (patienceRate > 0) {
    return { ...mmckm(arrivalRate, serviceRate, servers, capacity, patienceRate), WqByClass: null };
  }

  let result;
  if (capacity !== Infinity) result = mmck(arrivalRate, serviceRate, servers, capacity);
  else if (servers === 1) result = mm1(arrivalRate, serviceRate);
  else result = mmc(arrivalRate, serviceRate, servers);

  // Cobham's formula assumes an unlimited queue. For M/M/c/K there is no
  // simple closed form, so the only reference there is the simulation.
  const hasPriorityFormula =
    config.discipline === DISCIPLINE.PRIORITY && capacity === Infinity && result.stable;
  result.WqByClass = hasPriorityFormula
    ? priorityWaits(arrivalRate, serviceRate, servers, config.priorityShare)
    : null;
  return result;
}

/**
 * ρ >= 1 with an unlimited queue: customers arrive faster than all servers
 * together can serve them. The series p_n does not converge, there is no
 * steady state, and the queue grows without bound at roughly (λ - cμ)
 * customers per unit of time.
 */
function unstable(model, arrivalRate, trafficIntensity) {
  return {
    model,
    stable: false,
    trafficIntensity,
    // Here ρ is no longer a utilization (a utilization cannot exceed 1).
    rho: trafficIntensity,
    P0: 0,
    L: Infinity,
    Lq: Infinity,
    W: Infinity,
    Wq: Infinity,
    waitProbability: 1,
    blockingProbability: 0,
    effectiveArrivalRate: arrivalRate,
    waitTail: () => 1,
  };
}
