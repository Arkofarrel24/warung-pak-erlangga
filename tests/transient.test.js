/**
 * The transient solver: Kolmogorov forward equations for one day.
 *
 * The solver is checked against results that are known exactly by other
 * means, so that it can then serve as the reference for the simulation
 * engine in validation-day.test.js.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { mmck, mmckm } from '../src/analytic/formulas.js';
import { solveDay } from '../src/analytic/transient.js';
import { DAY_CASE as BUSY_DAY } from './reference-cases-day.js';

function assertClose(actual, expected, tolerance, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, got ${actual}`,
  );
}

const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);

test('run long enough at constant rates, it settles at the steady-state formula', () => {
  const model = { arrivalRate: 30, serviceRate: 10, servers: 2, waitingRoom: 4, patienceRate: 4 };
  const steady = mmckm(30, 10, 2, 6, 4);
  const { atClose } = solveDay({ ...model, closingTime: 30 });

  assertClose(atClose.meanInSystem, steady.L, 1e-8, 'L');
  assertClose(atClose.meanQueue, steady.Lq, 1e-8, 'Lq');
  assertClose(atClose.meanBusy / 2, steady.rho, 1e-8, 'rho');
  assertClose(atClose.emptyProbability, steady.P0, 1e-8, 'P0');
  assertClose(atClose.fullProbability, steady.blockingProbability, 1e-8, 'P_K');
});

test('without reneging it settles at the M/M/c/K formula', () => {
  // The emission inspection station, M/M/3/7 (Gross & Harris).
  const steady = mmck(60, 10, 3, 7);
  const { atClose, reneged } = solveDay({
    arrivalRate: 60,
    serviceRate: 10,
    servers: 3,
    waitingRoom: 4,
    closingTime: 30,
  });

  assertClose(atClose.meanInSystem, steady.L, 1e-8, 'L');
  assertClose(atClose.meanQueue, steady.Lq, 1e-8, 'Lq');
  assertClose(atClose.emptyProbability, steady.P0, 1e-8, 'P0');
  assertClose(atClose.fullProbability, steady.blockingProbability, 1e-8, 'P_K');
  assert.equal(reneged, 0);
});

test('a rising arrival rate: the exact transient solution of M(t)/M/∞', () => {
  // With θ = μ every customer present leaves at rate μ, so the number in the
  // system is that of an infinite-server queue. For that queue the transient
  // answer is known exactly, even with a changing arrival rate: N(t) is
  // Poisson distributed with mean m(t), where m' = λ(t) - μ·m and m(0) = 0.
  //
  // Here λ(t) = 4 + 4t and μ = 2, which gives
  //   m(t)         = 1 + 2t - e^(-2t)
  //   ∫ m dt, 0..t = t + t² + (e^(-2t) - 1)/2
  const horizon = 3;
  const meanAtEnd = 1 + 2 * horizon - Math.exp(-2 * horizon);
  const customerTime = horizon + horizon ** 2 + (Math.exp(-2 * horizon) - 1) / 2;

  const { atClose, periods, rejected } = solveDay({
    arrivalProfile: [
      { time: 0, rate: 4 },
      { time: horizon, rate: 16 },
    ],
    serviceRate: 2,
    servers: 3,
    // Large enough that practically nobody is ever turned away.
    waitingRoom: 60,
    patienceRate: 2,
    closingTime: horizon,
    periodLength: horizon,
  });

  assertClose(atClose.meanInSystem, meanAtEnd, 1e-7, 'm(3)');
  assertClose(atClose.emptyProbability, Math.exp(-meanAtEnd), 1e-9, 'P(N = 0) = e^(-m)');
  // Customer-time in the system during opening hours: waiting + in service.
  assertClose(periods[0].totalQueueTime + periods[0].totalBusyTime, customerTime, 1e-7, '∫ m dt');
  // 4·3 + 4·3²/2 = 30 arrivals expected.
  assertClose(periods[0].arrivals, 30, 1e-12);
  assert.ok(rejected < 1e-12);
});

test('staff coming on duty call everyone who is waiting', () => {
  // Nobody is on duty for the first hour while customers arrive at rate 2
  // into 5 waiting seats. With no service and no reneging, the number
  // waiting at t = 1 is min(X, 5) with X Poisson(2). Then five servers come
  // on duty at once and arrivals stop.
  const p = [0, 1, 2, 3, 4].map((k) => (Math.exp(-2) * 2 ** k) / [1, 1, 2, 6, 24][k]);
  const tail = 1 - p.reduce((total, pk) => total + pk, 0);
  const waiting = p.reduce((total, pk, k) => total + k * pk, 0) + 5 * tail;

  const serviceRate = 3;
  const { periods, served, rejected, reneged } = solveDay({
    arrivalProfile: [
      { time: 0, rate: 2 },
      { time: 1, rate: 2 },
      { time: 1, rate: 0 },
    ],
    serviceRate,
    staffSchedule: [
      { time: 0, servers: 0 },
      { time: 1, servers: 5 },
    ],
    waitingRoom: 5,
    closingTime: 2,
    periodLength: 1,
  });

  // First hour: nobody can be served.
  assertClose(periods[0].served, 0, 1e-12);
  assertClose(periods[0].totalBusyTime, 0, 1e-12);
  // Second hour: every waiting customer is in service from the first moment,
  // and each is finished within the hour with probability 1 - e^(-μ). The
  // tolerance is the accuracy of the numerical method at its default step.
  assertClose(periods[1].served, waiting * (1 - Math.exp(-serviceRate)), 1e-6);
  assertClose(periods[1].totalQueueTime, 0, 1e-9, 'nobody is left waiting');
  // In the end everyone who got a seat is served, and the rest were turned away.
  assertClose(served, waiting, 1e-6, 'served');
  assertClose(rejected, 2 - waiting, 1e-6, 'turned away');
  assert.equal(reneged, 0);
});

test('a cut in staff interrupts nobody', () => {
  // Eight servers and no waiting seats for one hour, λ = μ = 1. Being turned
  // away is practically impossible, so the number in service at t = 1 is that
  // of M/M/∞: Poisson with mean 1 - e^(-1). Then every server's shift ends
  // and arrivals stop. Nobody is interrupted, so all of them are served.
  const inService = 1 - Math.exp(-1);
  const { periods, served } = solveDay({
    arrivalProfile: [
      { time: 0, rate: 1 },
      { time: 1, rate: 1 },
      { time: 1, rate: 0 },
    ],
    serviceRate: 1,
    staffSchedule: [
      { time: 0, servers: 8 },
      { time: 1, servers: 0 },
    ],
    waitingRoom: 0,
    closingTime: 3,
    periodLength: 1,
  });

  // Expected arrivals in the first hour are 1, of which e^(-1) are done by t = 1.
  assertClose(periods[0].served, Math.exp(-1), 1e-6);
  assertClose(periods[1].served, inService * (1 - Math.exp(-1)), 1e-6);
  assertClose(served, 1, 1e-6, 'everyone who came in is served in the end');
  // On [1, 2] the scheduled staff is zero, yet servers are at their post
  // exactly while they are busy.
  assertClose(periods[1].totalStaffedTime, periods[1].totalBusyTime, 1e-9);
});

test('flow conservation over a whole day', () => {
  const result = solveDay(BUSY_DAY);

  assert.ok(result.rejected > 1 && result.reneged > 1, 'the day is busy enough to lose customers');
  assertClose(
    result.rejected + result.reneged + result.served,
    result.arrivals,
    1e-6,
    'turned away + gave up + served',
  );
  assert.ok(result.unresolved < 1e-9);
  assert.ok(result.overtime > 0);
});

test('the periods add up to the day', () => {
  const result = solveDay(BUSY_DAY);
  const { periods } = result;

  for (const key of [
    'arrivals',
    'rejected',
    'reneged',
    'served',
    'totalQueueTime',
    'totalBusyTime',
    'totalStaffedTime',
  ]) {
    assertClose(sum(periods, key), result[key], 1e-9, key);
  }
  periods.slice(0, 12).forEach((period, hour) => {
    assert.equal(period.from, hour);
    assert.equal(period.to, hour + 1);
    assert.ok(period.rho >= 0 && period.rho <= 1, `rho of hour ${hour}`);
  });
  // Scheduled staff time: 2·4.5 + 3·3 + 2·2 + 3·2 + 1·0.5
  assertClose(result.scheduledStaffTime, 28.5, 1e-12);
});

test('the offered load of each hour is Λ / (μ · staff time)', () => {
  const { periods } = solveDay(BUSY_DAY);

  // Hour 0-1: λ runs from 10 to 11.33, so Λ = 10.67, against 2 servers at μ = 15.
  assertClose(periods[0].trafficIntensity, (10 + 34 / 3) / 2 / 30, 1e-12);
  // Hour 5-6: λ = 45 against 3 servers, exactly as much work as they can do.
  assertClose(periods[5].trafficIntensity, 1, 1e-12);
  assert.ok(Number.isNaN(periods.at(-1).trafficIntensity), 'no arrivals after closing');
});

test('a smaller step does not change the answer', () => {
  const coarse = solveDay(BUSY_DAY);
  const fine = solveDay(BUSY_DAY, { safety: 0.125 });

  for (const key of ['rejected', 'reneged', 'served', 'totalQueueTime', 'totalBusyTime', 'overtime']) {
    const relative = Math.abs(coarse[key] - fine[key]) / fine[key];
    assert.ok(relative < 1e-6, `${key}: ${coarse[key]} against ${fine[key]}`);
  }
});

test('the error shrinks 16-fold when the step is halved (fourth order)', () => {
  // The same M(t)/M/∞ case as above, whose exact answer is known.
  const exact = 1 + 2 * 3 - Math.exp(-6);
  const model = {
    arrivalProfile: [
      { time: 0, rate: 4 },
      { time: 3, rate: 16 },
    ],
    serviceRate: 2,
    servers: 3,
    waitingRoom: 60,
    patienceRate: 2,
    closingTime: 3,
  };
  const errorAt = (safety) => Math.abs(solveDay(model, { safety }).atClose.meanInSystem - exact);
  const ratio = errorAt(1) / errorAt(0.5);

  assert.ok(ratio > 12 && ratio < 20, `error ratio ${ratio}`);
});

test('a line that cannot clear is reported, not waited for', () => {
  // The only server goes home at 2.0 and customers never give up.
  const result = solveDay(
    {
      arrivalRate: 5,
      serviceRate: 10,
      staffSchedule: [
        { time: 0, servers: 1 },
        { time: 2, servers: 0 },
      ],
      waitingRoom: 3,
      closingTime: 4,
    },
    { maxDrain: 5 },
  );

  assert.ok(result.unresolved > 0.99, `unresolved ${result.unresolved}`);
  assertClose(result.overtime, 5, 0.05, 'the solver gives up after maxDrain');
});

test('an unlimited waiting room is rejected', () => {
  const model = { arrivalRate: 5, serviceRate: 10, servers: 1, closingTime: 4 };

  assert.throws(() => solveDay({ ...model, waitingRoom: Infinity }), RangeError);
  assert.throws(() => solveDay(model), RangeError);
  assert.throws(() => solveDay({ ...model, waitingRoom: 3, closingTime: 0 }), RangeError);
});
