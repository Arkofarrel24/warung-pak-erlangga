/**
 * Regression test against the original QueueLab engine.
 *
 * The engine in this project is the QueueLab engine with reneging, a
 * time-varying arrival rate, staff schedules, and a closing time added. As
 * long as none of those is switched on, it has to behave exactly like the
 * engine that was validated against the M/M/c formulas.
 *
 * The numbers below were produced by running the unmodified QueueLab engine
 * (simulator-antrean, commit 4ed6b7e) on these configurations. They are
 * compared with strict equality: not "close", but identical in every digit.
 * `events` is the number of events processed and `timeChecksum` the sum of
 * all event times, so a change in even one event would show up.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { QueueSimulation } from '../src/sim/engine.js';

const GOLDEN = {
  'M/M/1 with a warm-up': {
    config: { arrivalRate: 8, serviceRate: 10, duration: 500, warmup: 50, seed: 11 },
    events: 7971,
    timeChecksum: 1996452.0219716174,
    results: {
      rho: 0.784141609141473,
      L: 3.9358801157656913,
      Lq: 3.151738506624237,
      W: 0.49504301316837585,
      Wq: 0.3963768814209756,
      P0: 0.2158583908585271,
      observedTime: 450,
      arrivals: 3580,
      rejected: 0,
      served: 3575,
      rejectionRate: 0,
      effectiveArrivalRate: 7.955555555555556,
    },
  },
  'overloaded M/M/3/7': {
    config: { arrivalRate: 60, serviceRate: 10, servers: 3, capacity: 7, duration: 300, seed: 22 },
    events: 26851,
    timeChecksum: 4041842.025394903,
    results: {
      rho: 0.9908162853928383,
      L: 6.085874176273506,
      Lq: 3.1134253200949824,
      W: 0.20680003436588348,
      Wq: 0.10578286525051162,
      P0: 0.001122895376761208,
      observedTime: 300,
      arrivals: 18028,
      rejected: 9199,
      served: 8822,
      rejectionRate: 0.5102618149545152,
      effectiveArrivalRate: 29.43,
    },
  },
  'M/M/2 with priority': {
    config: {
      arrivalRate: 14,
      serviceRate: 8,
      servers: 2,
      discipline: 'PRIORITY',
      priorityShare: 0.3,
      duration: 400,
      warmup: 20,
      seed: 33,
      replication: 2,
    },
    events: 11221,
    timeChecksum: 2237612.0917371837,
    results: {
      rho: 0.8652084848150633,
      L: 7.175898641139373,
      Lq: 5.445481671509243,
      W: 0.5126697830492922,
      Wq: 0.389096308238988,
      P0: 0.0749585159031976,
      observedTime: 380,
      arrivals: 5318,
      rejected: 0,
      served: 5303,
      rejectionRate: 0,
      effectiveArrivalRate: 13.994736842105263,
      WqByClass: [0.06896974095401077, 0.5302058733404302],
    },
  },
  'M/M/2 with LIFO': {
    config: { arrivalRate: 9, serviceRate: 5, servers: 2, discipline: 'LIFO', duration: 400, seed: 44 },
    events: 7222,
    timeChecksum: 1469357.5597697932,
    results: {
      rho: 0.9221882856018623,
      L: 9.866821246720074,
      Lq: 8.022444675516338,
      W: 0.9985038578279697,
      Wq: 0.7941241509061882,
      P0: 0.04391618864236447,
      observedTime: 400,
      arrivals: 3617,
      rejected: 0,
      served: 3604,
      rejectionRate: 0,
      effectiveArrivalRate: 9.0425,
    },
  },
  'M/M/2/2 with no waiting room': {
    config: { arrivalRate: 10, serviceRate: 10, servers: 2, capacity: 2, duration: 300, seed: 55 },
    events: 5273,
    timeChecksum: 784686.5845363175,
    results: {
      rho: 0.39167310585274717,
      L: 0.7833462117054943,
      Lq: 0,
      W: 0.101080331513677,
      Wq: 0,
      P0: 0.4119855046935194,
      observedTime: 300,
      arrivals: 2949,
      rejected: 625,
      served: 2323,
      rejectionRate: 0.2119362495761275,
      effectiveArrivalRate: 7.746666666666667,
    },
  },
};

function trace(config) {
  const simulation = new QueueSimulation(config);
  let events = 0;
  let timeChecksum = 0;
  for (let event = simulation.step(); event; event = simulation.step()) {
    events++;
    timeChecksum += event.time;
  }
  return { events, timeChecksum, results: simulation.results };
}

for (const [name, golden] of Object.entries(GOLDEN)) {
  test(`identical to the original engine: ${name}`, () => {
    const actual = trace(golden.config);

    assert.equal(actual.events, golden.events, 'number of events');
    assert.equal(actual.timeChecksum, golden.timeChecksum, 'sum of event times');
    for (const [metric, expected] of Object.entries(golden.results)) {
      assert.deepEqual(actual.results[metric], expected, metric);
    }
  });

  test(`the new features stay silent when switched off: ${name}`, () => {
    const { results } = trace(golden.config);

    assert.equal(results.reneged, 0);
    assert.equal(results.overtime, 0);
    assert.deepEqual(results.periods, []);
    // Nobody gave up, so the wait over "everyone who got in" is the ordinary Wq.
    assert.equal(results.WqAll, results.Wq);
  });
}

test('spelling out the defaults changes nothing', () => {
  const { config } = GOLDEN['overloaded M/M/3/7'];
  const { servers, capacity, ...rest } = config;
  const base = trace(config);

  // K = 7 with c = 3 is the same system as 4 waiting seats.
  const withWaitingRoom = trace({ ...rest, servers, waitingRoom: capacity - servers });
  // Unlimited patience and a schedule that never changes are the defaults in disguise.
  const withPatience = trace({ ...config, patienceRate: 0 });
  const withSchedule = trace({
    ...rest,
    staffSchedule: [{ time: 0, servers }],
    waitingRoom: capacity - servers,
  });

  for (const variant of [withWaitingRoom, withPatience, withSchedule]) {
    assert.equal(variant.events, base.events);
    assert.equal(variant.timeChecksum, base.timeChecksum);
    for (const metric of ['L', 'Lq', 'W', 'Wq', 'P0', 'arrivals', 'rejected', 'served']) {
      assert.equal(variant.results[metric], base.results[metric], metric);
    }
  }
  // ρ of the schedule variant comes from summed-up staff time instead of c·T,
  // which can differ in the last digits only.
  assert.ok(Math.abs(withSchedule.results.rho - base.results.rho) < 1e-12);
});
