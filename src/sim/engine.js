/**
 * Discrete-event simulation engine for Markovian queues.
 *
 * The simulation clock does not tick in fixed steps. It jumps straight to the
 * next event in the future event list (FEL), because nothing in the system
 * changes between two events.
 *
 * With the default settings this is the M/M/c and M/M/c/K engine of QueueLab,
 * unchanged down to the last digit. The warung game switches on four more
 * features, each of them optional:
 *
 *   - a time-varying arrival rate λ(t)      non-homogeneous Poisson process
 *   - customers who give up waiting          reneging, the "+M" of M/M/c/K+M
 *   - a number of servers that changes       staff schedule c(t)
 *   - a closing time                         a terminating simulation: one day
 *
 * Any time unit works as long as it is used consistently: if the rates are in
 * customers per hour, then every time is in hours.
 *
 * This module never touches the DOM, so it runs in Node for testing and in
 * the browser for the animation.
 */

import { ArrivalProfile } from './arrival-profile.js';
import { EventQueue } from './event-queue.js';
import { createRng, exponential, STREAM } from './rng.js';
import { DISCIPLINE, PRIORITY_CLASS, WaitingLine } from './waiting-line.js';

export { DISCIPLINE, PRIORITY_CLASS };

export const EVENT = Object.freeze({
  ARRIVAL: 'ARRIVAL',
  DEPARTURE: 'DEPARTURE',
  RENEGE: 'RENEGE',
  STAFF_CHANGE: 'STAFF_CHANGE',
  CLOSE: 'CLOSE',
  WARMUP_END: 'WARMUP_END',
  END: 'END',
});

/**
 * What happens to a customer at the moment of arrival.
 *
 * REJECTED is balking: the customer finds every server busy and every waiting
 * seat taken, and leaves at once without joining. Queueing texts also call it
 * blocking, because here the customer has no choice in the matter.
 */
export const ARRIVAL_OUTCOME = Object.freeze({
  SERVED: 'SERVED',
  QUEUED: 'QUEUED',
  REJECTED: 'REJECTED',
});

const DEFAULTS = Object.freeze({
  servers: 1,
  discipline: DISCIPLINE.FIFO,
  capacity: Infinity,
  priorityShare: 0.2,
  patienceRate: 0,
  warmup: 0,
  seed: 1,
  replication: 0,
});

const MAX_SEED = 0xffffffff;

/**
 * @typedef {object} SimulationConfig
 * @property {number} [arrivalRate]  λ, a constant arrival rate (customers per unit of time)
 * @property {{ time: number, rate: number }[]} [arrivalProfile]
 *   λ(t), an arrival rate that changes over time, as points joined by
 *   straight lines. Give either this or arrivalRate, not both.
 * @property {number} serviceRate    μ, service rate of one server
 * @property {number} [servers]      c, number of servers
 * @property {{ time: number, servers: number }[]} [staffSchedule]
 *   c(t), a number of servers that changes over time. The first entry must be
 *   at time 0. When given, `servers` is set to the largest number on duty.
 * @property {string} [discipline]   one of the DISCIPLINE values
 * @property {number} [capacity]     K, maximum number of customers in the system
 *                                   (waiting + in service); Infinity = unlimited
 * @property {number} [waitingRoom]  maximum number of customers waiting, that is
 *   K - c. Another way to give the capacity, and the only one that makes sense
 *   with a staff schedule: the seats stay put while c changes.
 * @property {number} [patienceRate] θ, the rate at which a waiting customer gives
 *   up. Patience is exponential with mean 1/θ. 0 = customers never give up.
 * @property {number} [priorityShare] share of customers in the priority class
 *                                   (0 to 1), used only by the PRIORITY discipline
 * @property {number} [duration]     run length, warm-up included. Required
 *   unless closingTime is given; together with closingTime it is a hard stop.
 * @property {number} [closingTime]  the doors close at this time: nobody new
 *   arrives, and the run ends once the last customer inside has left
 * @property {number} [warmup]       warm-up period whose data is discarded
 * @property {number} [periodLength] when given, the statistics are also kept
 *   per period of this length (for example per hour)
 * @property {number} [seed]         seed for the random number generator
 * @property {number} [replication]  replication index; selects a different random sequence
 * @property {(wait: number, customer: object) => void} [onWait]
 *   called every time an observed customer starts service, with that
 *   customer's waiting time. Used to build a histogram without storing every value.
 * @property {() => number} [sampleInterarrival] replaces the interarrival-time generator
 * @property {() => number} [sampleService]      replaces the service-time generator
 * @property {() => number} [samplePatience]     replaces the patience generator
 *   The last three exist for testing: with a hand-picked sequence of times,
 *   the course of the simulation can be worked out by hand and then compared.
 */

export class QueueSimulation {
  #stats;
  #periods = [];
  #statsStart = 0;
  #warmedUp;
  #nextCustomerId = 1;
  #nextArrivalTime;
  #sampleService;
  #samplePatience;
  #priorityRng;
  /** Pending RENEGE events by customer id, so they can be cancelled. */
  #renegeEvents = new Map();
  #endScheduled = false;

  /** @param {SimulationConfig} config */
  constructor(config) {
    this.config = normalizeConfig(config);
    const {
      arrivalRate,
      arrivalProfile,
      serviceRate,
      servers,
      staffSchedule,
      discipline,
      patienceRate,
      duration,
      closingTime,
      warmup,
      seed,
      replication,
    } = this.config;

    this.clock = 0;
    this.finished = false;
    /** True once the doors have closed and no new customer can arrive. */
    this.closed = false;
    /** One entry per server: the customer being served, or null when idle. */
    this.servers = new Array(servers).fill(null);
    this.busyServers = 0;
    /** c(t): the number of servers on duty right now. */
    this.staff = staffSchedule ? staffSchedule[0].servers : servers;
    this.line = new WaitingLine(discipline);
    this.fel = new EventQueue();

    // The first "M" in Kendall's notation M/M/c: arrivals follow a Poisson
    // process with rate λ, which is the same as exponentially distributed
    // interarrival times with mean 1/λ.
    const arrivalRng = createRng(seed, replication, STREAM.ARRIVAL);
    if (this.config.sampleInterarrival) {
      this.#nextArrivalTime = () => this.clock + this.config.sampleInterarrival();
    } else if (arrivalProfile) {
      const profile = new ArrivalProfile(arrivalProfile);
      const thinningRng = createRng(seed, replication, STREAM.THINNING);
      // Past this time no arrival can matter, which is what stops the search below.
      const horizon = closingTime ?? duration;
      this.#nextArrivalTime = () => this.#thinnedArrivalTime(profile, arrivalRng, thinningRng, horizon);
    } else {
      this.#nextArrivalTime = () => this.clock + exponential(arrivalRng, arrivalRate);
    }

    // The second "M": each server's service time is exponentially distributed
    // with mean 1/μ.
    const serviceRng = createRng(seed, replication, STREAM.SERVICE);
    this.#sampleService =
      this.config.sampleService ?? (() => exponential(serviceRng, serviceRate));

    this.#priorityRng = createRng(seed, replication, STREAM.PRIORITY);

    // The "+M" in M/M/c/K+M: each customer's patience is exponentially
    // distributed with mean 1/θ. It has its own random stream, so switching
    // reneging on or off leaves the arrival and service sequences untouched.
    const patienceRng = createRng(seed, replication, STREAM.PATIENCE);
    const exponentialPatience =
      patienceRate > 0 ? () => exponential(patienceRng, patienceRate) : null;
    this.#samplePatience = this.config.samplePatience ?? exponentialPatience;

    this.#resetStats();
    this.#warmedUp = warmup === 0;

    this.#scheduleNextArrival();
    if (warmup > 0) this.fel.schedule(warmup, EVENT.WARMUP_END);
    if (duration !== Infinity) this.fel.schedule(duration, EVENT.END);
    if (closingTime !== undefined) this.fel.schedule(closingTime, EVENT.CLOSE);
    for (const change of staffSchedule?.slice(1) ?? []) {
      this.fel.schedule(change.time, EVENT.STAFF_CHANGE, { servers: change.servers });
    }
  }

  /** Number of customers waiting, not yet in service. */
  get queueLength() {
    return this.line.length;
  }

  /** Number of customers in the system: waiting + in service. */
  get numberInSystem() {
    return this.busyServers + this.line.length;
  }

  /**
   * Processes exactly one event and returns a record of what happened.
   * Returns null once the simulation has finished.
   */
  step() {
    if (this.finished) return null;

    const event = this.fel.pop();
    // Nothing is scheduled any more, or only at a time that never comes, so
    // nothing can ever change again. This happens when the doors are closed
    // but the people still waiting can neither be served (no staff) nor give
    // up (unlimited patience).
    if (!event || event.time === Infinity) return this.#finish();

    // Time-average statistics are accumulated before the state changes: over
    // the interval (clock, event.time) the state is still the one from before
    // this event.
    this.#accumulate(event.time);
    this.clock = event.time;

    const record = this.#handle(event);

    // A day is a terminating simulation: it ends not at a fixed time but when
    // the doors are closed and the last customer inside has left. No customer
    // is cut off mid-wait, so none is missing from the statistics.
    if (this.closed && !this.#endScheduled && !this.finished && this.numberInSystem === 0) {
      this.fel.schedule(this.clock, EVENT.END);
      this.#endScheduled = true;
    }
    return record;
  }

  /** Runs the simulation to the end and returns its results. */
  run() {
    while (!this.finished) this.step();
    return this.results;
  }

  /** True once the warm-up period has passed, that is, once statistics count. */
  get warmedUp() {
    return this.#warmedUp;
  }

  /**
   * Performance measures collected from the end of the warm-up period until
   * now. Safe to read mid-run; during the warm-up they are provisional
   * figures that will be discarded.
   */
  get results() {
    const stats = this.#stats;
    const { servers, staffSchedule, closingTime } = this.config;
    const observedTime = this.clock - this.#statsStart;
    const accepted = stats.arrivals - stats.rejected;
    // Server time at their post. With a fixed number of servers that is c·T.
    const staffedTime = staffSchedule ? stats.areaStaffed : servers * observedTime;

    return {
      // ρ, utilization: the share of their time at their post that servers are busy.
      rho: stats.areaBusy / staffedTime,
      // L = (1/T) ∫ N(t) dt, the time average of the number in the system.
      L: stats.areaSystem / observedTime,
      // Lq = (1/T) ∫ Nq(t) dt, the time average of the number waiting.
      Lq: stats.areaQueue / observedTime,
      // W: mean time in the system (waiting + service) per served customer.
      W: stats.sumSystemTime / stats.departures,
      // Wq: mean waiting time before service starts, per customer who was
      // served. Customers who gave up are not in this average; see WqAll.
      Wq: stats.sumWait / stats.serviceStarts,
      // P0: the share of time the system is completely empty.
      P0: stats.timeEmpty / observedTime,

      observedTime,
      arrivals: stats.arrivals,
      rejected: stats.rejected,
      served: stats.departures,
      // Share of customers turned away. For M/M/c/K it estimates P_K, the
      // probability that the system is full.
      rejectionRate: stats.rejected / stats.arrivals,
      // Effective λ: the rate of customers who actually get in, λ(1 - P_K).
      effectiveArrivalRate: accepted / observedTime,
      // Wq per class, in PRIORITY_CLASS order: [HIGH, REGULAR].
      WqByClass: stats.sumWaitByClass.map((sum, k) => sum / stats.serviceStartsByClass[k]),

      // Reneging: customers who joined the line and left it before being served.
      reneged: stats.reneged,
      // Share of all arriving customers who gave up waiting.
      renegeRate: stats.reneged / stats.arrivals,
      // Mean time a reneging customer spent in line, which is their patience.
      WqReneged: stats.sumWaitReneged / stats.reneged,
      // Mean time in line over everyone who got in, served or not. This is the
      // waiting time that satisfies Little's law: Lq = λ_eff · WqAll.
      WqAll: (stats.sumWait + stats.sumWaitReneged) / (stats.serviceStarts + stats.reneged),

      // The raw areas under the curves, for example in customer-hours.
      totalQueueTime: stats.areaQueue,
      totalBusyTime: stats.areaBusy,
      totalStaffedTime: staffedTime,

      endTime: this.clock,
      // How long the staff had to stay after closing to clear the customers inside.
      overtime: this.closed ? this.clock - closingTime : 0,
      // Customers still inside when the run stopped; 0 after a day that ran to its end.
      leftInSystem: this.numberInSystem,
      periods: this.#periodResults(),
    };
  }

  #handle(event) {
    switch (event.type) {
      case EVENT.ARRIVAL:
        return this.#handleArrival();
      case EVENT.DEPARTURE:
        return this.#handleDeparture(event.data.serverIndex);
      case EVENT.RENEGE:
        return this.#handleRenege(event.data.customer);
      case EVENT.STAFF_CHANGE:
        return this.#handleStaffChange(event.data.servers);
      case EVENT.CLOSE:
        // Arrivals stop on their own: none is ever scheduled at or after the
        // closing time. Customers already inside stay.
        this.closed = true;
        return { type: EVENT.CLOSE, time: this.clock };
      case EVENT.WARMUP_END:
        // Only the statistics are thrown away. Customers who are waiting or
        // being served stay where they are: this "already filled" condition is
        // precisely the starting point we want to observe from.
        this.#resetStats();
        this.#warmedUp = true;
        return { type: EVENT.WARMUP_END, time: this.clock };
      default:
        return this.#finish();
    }
  }

  #finish() {
    this.finished = true;
    return { type: EVENT.END, time: this.clock };
  }

  /**
   * Every arrival schedules the next one, so the FEL holds at most one
   * ARRIVAL event. Once the doors have closed there is none.
   */
  #scheduleNextArrival() {
    const time = this.#nextArrivalTime();
    const lastCall = this.config.closingTime ?? Infinity;
    if (time < lastCall) this.fel.schedule(time, EVENT.ARRIVAL);
  }

  /**
   * The next arrival of a non-homogeneous Poisson process, by thinning
   * (Lewis & Shedler, 1979).
   *
   * Simply drawing the next gap from the current rate λ(t) would be wrong: a
   * long gap drawn during a quiet hour would jump right over the lunch rush
   * as if the rate had never risen. Thinning avoids that:
   *
   *   1. Generate candidate arrivals from an ordinary Poisson process at the
   *      highest rate, λ_max.
   *   2. Keep a candidate at time t with probability λ(t)/λ_max, and drop it
   *      otherwise.
   *
   * The kept candidates form a Poisson process with rate exactly λ(t):
   * randomly deleting points of a Poisson process leaves a Poisson process.
   *
   * @returns {number} the time of the next arrival, or Infinity when there is
   *   none before the horizon
   */
  #thinnedArrivalTime(profile, arrivalRng, thinningRng, horizon) {
    const maxRate = profile.maxRate;
    let time = this.clock;
    for (;;) {
      time += exponential(arrivalRng, maxRate);
      if (time >= horizon) return Infinity;
      if (thinningRng() * maxRate < profile.rateAt(time)) return time;
    }
  }

  #handleArrival() {
    this.#scheduleNextArrival();

    const customer = {
      id: this.#nextCustomerId++,
      arrivalTime: this.clock,
      priorityClass: this.#drawPriorityClass(),
      // How long this customer is willing to wait. It is drawn for everyone,
      // including those who end up not waiting at all, so that customer
      // number n has the same patience in every scenario being compared.
      patience: this.#samplePatience ? this.#samplePatience() : Infinity,
      serviceStart: null,
      serviceEnd: null,
      renegedAt: null,
    };
    this.#count('arrivals');

    const record = {
      type: EVENT.ARRIVAL,
      time: this.clock,
      customer,
      outcome: ARRIVAL_OUTCOME.QUEUED,
      serverIndex: -1,
    };

    // A server can take the customer only while fewer servers are busy than
    // are on duty.
    const idleServer = this.busyServers < this.staff ? this.servers.indexOf(null) : -1;

    // Balking, the "/K" in M/M/c/K: with no free server and no free waiting
    // seat the system is full, and the newcomer is turned away and lost (no
    // retry). With a fixed c this is the same test as "K customers are
    // already in the system", because K = c + waiting seats.
    if (idleServer === -1 && this.line.length >= this.config.waitingRoom) {
      this.#count('rejected');
      record.outcome = ARRIVAL_OUTCOME.REJECTED;
      return record;
    }

    if (idleServer === -1) {
      this.line.push(customer);
      this.#scheduleRenege(customer);
    } else {
      this.#startService(customer, idleServer);
      record.outcome = ARRIVAL_OUTCOME.SERVED;
      record.serverIndex = idleServer;
    }
    return record;
  }

  #handleDeparture(serverIndex) {
    const customer = this.servers[serverIndex];
    this.servers[serverIndex] = null;
    this.busyServers--;

    if (this.#isObserved(customer)) {
      this.#add('sumSystemTime', this.clock - customer.arrivalTime);
      this.#count('departures');
    }

    // After a cut in staff more servers can be busy than are on duty. Such a
    // server finishes the customer in hand and then goes home.
    const staysOnDuty = this.busyServers < this.staff;

    // The server that just became free calls the next customer right away.
    // Who gets called is decided by the queue discipline.
    const next = staysOnDuty && this.line.length > 0 ? this.line.next() : null;
    if (next) this.#startService(next, serverIndex);

    return {
      type: EVENT.DEPARTURE,
      time: this.clock,
      customer,
      serverIndex,
      next,
      serverLeft: !staysOnDuty,
    };
  }

  /**
   * Reneging: the customer has waited as long as their patience allows and
   * walks out of the line unserved.
   */
  #handleRenege(customer) {
    this.#renegeEvents.delete(customer.id);
    this.line.remove(customer);
    customer.renegedAt = this.clock;

    if (this.#isObserved(customer)) {
      this.#count('reneged');
      this.#add('sumWaitReneged', this.clock - customer.arrivalTime);
    }
    return { type: EVENT.RENEGE, time: this.clock, customer };
  }

  /**
   * The number of servers on duty changes, c(t).
   *
   * - More staff: the newcomers call waiting customers at once.
   * - Less staff: idle servers leave first. A busy server is never pulled
   *   away from a customer; it leaves when that service ends (see
   *   #handleDeparture). Service is non-preemptive, as it is everywhere else
   *   in this engine.
   */
  #handleStaffChange(servers) {
    this.staff = servers;

    const started = [];
    while (this.busyServers < this.staff && this.line.length > 0) {
      const customer = this.line.next();
      const serverIndex = this.servers.indexOf(null);
      this.#startService(customer, serverIndex);
      started.push({ customer, serverIndex });
    }
    return { type: EVENT.STAFF_CHANGE, time: this.clock, servers, started };
  }

  /**
   * A customer who has to wait gets a RENEGE event at the moment their
   * patience runs out. If a server calls them first, #startService cancels it.
   */
  #scheduleRenege(customer) {
    if (customer.patience === Infinity) return;
    const event = this.fel.schedule(this.clock + customer.patience, EVENT.RENEGE, { customer });
    this.#renegeEvents.set(customer.id, event);
  }

  #startService(customer, serverIndex) {
    const pendingRenege = this.#renegeEvents.get(customer.id);
    if (pendingRenege) {
      this.fel.cancel(pendingRenege);
      this.#renegeEvents.delete(customer.id);
    }

    customer.serviceStart = this.clock;
    customer.serviceEnd = this.clock + this.#sampleService();
    this.servers[serverIndex] = customer;
    this.busyServers++;

    if (this.#isObserved(customer)) {
      const wait = this.clock - customer.arrivalTime;
      const stats = this.#stats;
      this.#add('sumWait', wait);
      this.#count('serviceStarts');
      stats.sumWaitByClass[customer.priorityClass] += wait;
      stats.serviceStartsByClass[customer.priorityClass]++;
      // During the warm-up the statistics will still be discarded, so the
      // value is not passed on yet.
      if (this.#warmedUp) this.config.onWait?.(wait, customer);
    }

    this.fel.schedule(customer.serviceEnd, EVENT.DEPARTURE, { serverIndex });
  }

  /**
   * Under the priority discipline, each customer joins the high class with
   * probability priorityShare. Randomly splitting a Poisson process of rate λ
   * this way yields two independent Poisson processes with rates p·λ and
   * (1 - p)·λ. That property is what makes Cobham's priority formula apply.
   */
  #drawPriorityClass() {
    const { discipline, priorityShare } = this.config;
    if (discipline !== DISCIPLINE.PRIORITY) return PRIORITY_CLASS.REGULAR;
    return this.#priorityRng() < priorityShare ? PRIORITY_CLASS.HIGH : PRIORITY_CLASS.REGULAR;
  }

  /**
   * W and Wq are computed only from customers who arrive after the warm-up.
   * Earlier customers met a system that was still empty, so their waits are
   * too short and would bias the average.
   */
  #isObserved(customer) {
    return customer.arrivalTime >= this.#statsStart;
  }

  /**
   * Adds to the area under the curve for the time-average statistics, for the
   * interval from the current clock time to `until`.
   *
   * Over that interval the state does not change, so the added area is a
   * rectangle: (state value) x dt. Dividing the total area by the observation
   * time gives the average over time.
   */
  #accumulate(until) {
    const dt = until - this.clock;
    const stats = this.#stats;
    const inQueue = this.line.length;
    const inSystem = this.busyServers + inQueue;
    stats.areaSystem += inSystem * dt;
    stats.areaQueue += inQueue * dt;
    stats.areaBusy += this.busyServers * dt;
    // Servers at their post: those on duty, plus any who are past the end of
    // their shift but still finishing a customer. So busy never exceeds it.
    const present = Math.max(this.staff, this.busyServers);
    stats.areaStaffed += present * dt;
    if (inSystem === 0) stats.timeEmpty += dt;

    // The same rectangle, cut up along the period boundaries it crosses.
    const { periodLength } = this.config;
    if (periodLength === undefined) return;
    let from = this.clock;
    let index = Math.floor(from / periodLength);
    while (from < until) {
      const stop = Math.min(until, (index + 1) * periodLength);
      if (stop > from) {
        const period = this.#periodAt(index);
        const span = stop - from;
        period.areaSystem += inSystem * span;
        period.areaQueue += inQueue * span;
        period.areaBusy += this.busyServers * span;
        period.areaStaffed += present * span;
        from = stop;
      }
      index++;
    }
  }

  /** Counts one occurrence, in the totals and in the period the clock is in. */
  #count(name) {
    this.#add(name, 1);
  }

  #add(name, amount) {
    this.#stats[name] += amount;
    const { periodLength } = this.config;
    if (periodLength !== undefined) {
      this.#periodAt(Math.floor(this.clock / periodLength))[name] += amount;
    }
  }

  #periodAt(index) {
    while (this.#periods.length <= index) this.#periods.push(emptyCounters());
    return this.#periods[index];
  }

  /**
   * The statistics per period. A daily average hides the rush hours: ρ can be
   * 0.6 over the whole day and well above 1 at lunch. Events are counted in
   * the period in which they happen.
   */
  #periodResults() {
    const { periodLength } = this.config;
    if (periodLength === undefined) return [];

    const results = [];
    for (let i = Math.floor(this.#statsStart / periodLength); i < this.#periods.length; i++) {
      const period = this.#periods[i];
      const from = Math.max(i * periodLength, this.#statsStart);
      const to = Math.min((i + 1) * periodLength, this.clock);
      const length = to - from;
      results.push({
        from,
        to,
        arrivals: period.arrivals,
        rejected: period.rejected,
        reneged: period.reneged,
        served: period.departures,
        rho: period.areaBusy / period.areaStaffed,
        L: period.areaSystem / length,
        Lq: period.areaQueue / length,
        Wq: period.sumWait / period.serviceStarts,
        // Mean number of servers at their post during the period.
        staff: period.areaStaffed / length,
        totalQueueTime: period.areaQueue,
        totalBusyTime: period.areaBusy,
        totalStaffedTime: period.areaStaffed,
      });
    }
    return results;
  }

  #resetStats() {
    this.#statsStart = this.clock;
    this.#periods = [];
    this.#stats = {
      ...emptyCounters(),
      timeEmpty: 0,
      serviceStartsByClass: [0, 0],
      sumWaitByClass: [0, 0],
    };
  }
}

/** The counters that are kept both in total and per period. */
function emptyCounters() {
  return {
    areaSystem: 0,
    areaQueue: 0,
    areaBusy: 0,
    areaStaffed: 0,
    arrivals: 0,
    rejected: 0,
    reneged: 0,
    departures: 0,
    sumSystemTime: 0,
    serviceStarts: 0,
    sumWait: 0,
    sumWaitReneged: 0,
  };
}

function normalizeConfig(input) {
  const config = { ...DEFAULTS, ...input };
  const { discipline, priorityShare, patienceRate, warmup, seed, replication } = config;

  if (config.arrivalProfile === undefined) {
    requirePositive(config.arrivalRate, 'Arrival rate (λ)');
  } else {
    if (config.arrivalRate !== undefined) {
      throw new RangeError('Give either a constant arrival rate (λ) or an arrival profile, not both.');
    }
    // Constructing the profile validates its points.
    new ArrivalProfile(config.arrivalProfile);
    config.arrivalProfile = Object.freeze(
      config.arrivalProfile.map(({ time, rate }) => Object.freeze({ time, rate })),
    );
  }
  requirePositive(config.serviceRate, 'Service rate (μ)');

  if (config.closingTime === undefined) {
    requirePositive(config.duration, 'Run length');
  } else {
    requirePositive(config.closingTime, 'Closing time');
    if (config.duration === undefined) {
      config.duration = Infinity;
    } else {
      requirePositive(config.duration, 'Run length');
      if (config.duration < config.closingTime) {
        throw new RangeError('Run length must not be shorter than the closing time.');
      }
    }
  }

  if (config.staffSchedule !== undefined) {
    if (input.servers !== undefined) {
      throw new RangeError('Give either a number of servers (c) or a staff schedule, not both.');
    }
    config.staffSchedule = normalizeStaffSchedule(config.staffSchedule);
    config.servers = Math.max(...config.staffSchedule.map((entry) => entry.servers));
  }
  const { servers } = config;
  if (!Number.isInteger(servers) || servers < 1) {
    throw new RangeError('Number of servers (c) must be an integer of at least 1.');
  }

  if (config.waitingRoom === undefined) {
    const { capacity } = config;
    if (capacity !== Infinity && (!Number.isInteger(capacity) || capacity < servers)) {
      throw new RangeError(
        'System capacity (K) must be an integer no smaller than the number of servers (c).',
      );
    }
    if (capacity !== Infinity && config.staffSchedule) {
      throw new RangeError(
        'With a staff schedule c changes over time, so give the waiting room (K - c) instead of K.',
      );
    }
    config.waitingRoom = capacity - servers;
  } else {
    const { waitingRoom } = config;
    if (config.capacity !== Infinity) {
      throw new RangeError('Give either the system capacity (K) or the waiting room, not both.');
    }
    if (waitingRoom !== Infinity && (!Number.isInteger(waitingRoom) || waitingRoom < 0)) {
      throw new RangeError('Waiting room must be a non-negative integer.');
    }
    // K = c + waiting seats. With a staff schedule this is the largest K of the day.
    config.capacity = servers + waitingRoom;
  }

  if (!Object.values(DISCIPLINE).includes(discipline)) {
    throw new RangeError(`Unknown queue discipline: ${discipline}.`);
  }
  if (!(priorityShare >= 0 && priorityShare <= 1)) {
    throw new RangeError('Priority share must be between 0 and 1.');
  }
  if (!(Number.isFinite(patienceRate) && patienceRate >= 0)) {
    throw new RangeError('Patience rate (θ) must be a number of at least 0.');
  }
  if (config.periodLength !== undefined) requirePositive(config.periodLength, 'Period length');
  if (!(warmup >= 0 && warmup < config.duration)) {
    throw new RangeError('Warm-up must be non-negative and shorter than the run length.');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`Seed must be an integer from 0 to ${MAX_SEED}.`);
  }
  if (!Number.isInteger(replication) || replication < 0) {
    throw new RangeError('Replication index must be a non-negative integer.');
  }
  return Object.freeze(config);
}

function normalizeStaffSchedule(schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0 || schedule[0].time !== 0) {
    throw new RangeError('Staff schedule must be a list of { time, servers } that starts at time 0.');
  }
  schedule.forEach(({ time, servers }, i) => {
    if (!Number.isFinite(time) || (i > 0 && time <= schedule[i - 1].time)) {
      throw new RangeError('Staff schedule times must be finite and strictly increasing.');
    }
    if (!Number.isInteger(servers) || servers < 0) {
      throw new RangeError('Staff schedule entries need a whole number of servers, 0 or more.');
    }
  });
  return Object.freeze(schedule.map(({ time, servers }) => Object.freeze({ time, servers })));
}

function requirePositive(value, label) {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${label} must be a positive number.`);
  }
}
