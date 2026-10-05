/**
 * The steady-state formula for queues with reneging, M/M/c/K+M.
 *
 * As in analytic.test.js, the expected values are worked out by hand or come
 * from an independent closed form, not from the module under test.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, mm1, mmc, mmck, mmckm } from '../src/analytic/formulas.js';

function assertClose(actual, expected, tolerance = 1e-12, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, got ${actual}`,
  );
}

function assertMetrics(result, expected, tolerance = 1e-12) {
  for (const [metric, value] of Object.entries(expected)) {
    assertClose(result[metric], value, tolerance, metric);
  }
}

test('M/M/1/2+M worked out by hand', () => {
  // λ = 2, μ = 1, θ = 1, one server, one waiting seat.
  // Death rates: δ1 = μ = 1 and δ2 = μ + θ = 2.
  // Weights: 1, λ/δ1 = 2, 2·λ/δ2 = 2. They add up to 5, so p = [0.2, 0.4, 0.4].
  assertMetrics(mmckm(2, 1, 1, 2, 1), {
    P0: 0.2,
    L: 0.4 + 2 * 0.4,
    Lq: 0.4,
    rho: 0.8,
    blockingProbability: 0.4,
    effectiveArrivalRate: 1.2,
    // Lq = 0.4 customers wait on average, each leaving at rate θ = 1.
    abandonmentRate: 0.4,
    renegeProbability: 0.2,
    throughput: 0.8,
    W: 1.2 / 1.2,
    Wq: 0.4 / 1.2,
    // Of the customers who get in, those who find one customer present wait:
    // p1 / (p0 + p1).
    waitProbability: 0.4 / 0.6,
    trafficIntensity: 2,
  });
});

test('when patience equals service time, the system behaves like M/M/∞', () => {
  // With θ = μ every customer present leaves at rate μ, waiting or not, so
  // the number in the system is that of an infinite-server queue: Poisson
  // distributed with mean a = λ/μ. Here a = 12/4 = 3 and c = 2.
  const a = 3;
  const e = Math.exp(-a);
  // E[busy] = P(N = 1) + 2·P(N >= 2) = 3e⁻³ + 2(1 - 4e⁻³) = 2 - 5e⁻³
  const busy = 2 - 5 * e;
  const result = mmckm(12, 4, 2, Infinity, 4);

  assert.equal(result.model, 'M/M/c+M');
  assertMetrics(result, {
    P0: e,
    L: a,
    Lq: a - busy,
    rho: busy / 2,
    blockingProbability: 0,
    effectiveArrivalRate: 12,
    renegeProbability: (4 * (a - busy)) / 12,
    throughput: 4 * busy,
    Wq: (a - busy) / 12,
    W: a / 12,
  });
});

test('without reneging it is the M/M/c/K formula', () => {
  for (const [arrivalRate, serviceRate, servers, capacity] of [
    [60, 10, 3, 7],
    [12, 10, 1, 5],
    [10, 10, 2, 2],
  ]) {
    const expected = mmck(arrivalRate, serviceRate, servers, capacity);
    const result = mmckm(arrivalRate, serviceRate, servers, capacity, 0);
    for (const metric of ['rho', 'P0', 'L', 'Lq', 'W', 'Wq', 'blockingProbability', 'waitProbability']) {
      assertClose(result[metric], expected[metric], 1e-12, `${metric} of M/M/${servers}/${capacity}`);
    }
    assert.equal(result.abandonmentRate, 0);
  }
});

test('with very patient customers it approaches the M/M/c formula', () => {
  const expected = mmc(24, 10, 3);
  const result = mmckm(24, 10, 3, Infinity, 1e-9);

  for (const metric of ['rho', 'P0', 'L', 'Lq', 'W', 'Wq', 'waitProbability']) {
    assertClose(result[metric], expected[metric], 1e-6, metric);
  }
});

test('flow conservation: every arrival is turned away, gives up, or is served', () => {
  for (const [arrivalRate, serviceRate, servers, capacity, patienceRate] of [
    [12, 10, 1, Infinity, 2],
    [24, 10, 3, Infinity, 5],
    [30, 10, 2, 6, 4],
    [45, 15, 3, 9, 6],
    [5, 15, 2, 4, 6],
  ]) {
    const result = mmckm(arrivalRate, serviceRate, servers, capacity, patienceRate);
    const turnedAway = arrivalRate * result.blockingProbability;

    assertClose(
      turnedAway + result.abandonmentRate + result.throughput,
      arrivalRate,
      1e-10,
      `λ = ${arrivalRate}`,
    );
    // Little's law for the customers who got in.
    assertClose(result.L, result.effectiveArrivalRate * result.W, 1e-12, 'L = λ_eff·W');
    assertClose(result.Lq, result.effectiveArrivalRate * result.Wq, 1e-12, 'Lq = λ_eff·Wq');
    assert.ok(result.rho >= 0 && result.rho <= 1);
  }
});

test('reneging keeps the system stable even when λ is far above cμ', () => {
  // λ = 100 against cμ = 1. An M/M/1 would have no steady state at all.
  assert.equal(mm1(100, 1).stable, false);

  const result = mmckm(100, 1, 1, Infinity, 0.5);
  assert.equal(result.stable, true);
  // The server is practically never idle, so about λ - μ = 99 customers per
  // unit of time must leave by reneging: Lq ≈ 99/θ = 198.
  assertClose(result.Lq, 198, 0.01, 'Lq');
  assertClose(result.rho, 1, 1e-9, 'rho');
  assertClose(result.trafficIntensity, 100, 1e-12);
});

test('more patient customers mean a longer line and fewer customers lost', () => {
  const impatient = mmckm(30, 10, 2, 8, 12);
  const patient = mmckm(30, 10, 2, 8, 2);

  assert.ok(patient.Lq > impatient.Lq);
  assert.ok(patient.renegeProbability < impatient.renegeProbability);
  // A longer line is more often full, so more customers balk instead.
  assert.ok(patient.blockingProbability > impatient.blockingProbability);
});

test('analyze picks the reneging model only when customers can give up', () => {
  const base = { arrivalRate: 30, serviceRate: 10, servers: 2 };

  assert.equal(analyze({ ...base, patienceRate: 4 }).model, 'M/M/c+M');
  assert.equal(analyze({ ...base, capacity: 6, patienceRate: 4 }).model, 'M/M/c/K+M');
  assert.equal(analyze({ ...base, capacity: 6 }).model, 'M/M/c/K');
  assert.equal(analyze({ ...base, capacity: 6, patienceRate: 0 }).model, 'M/M/c/K');

  // Four waiting seats with two servers is K = 6.
  const bySeats = analyze({ ...base, waitingRoom: 4, patienceRate: 4 });
  const byCapacity = analyze({ ...base, capacity: 6, patienceRate: 4 });
  assert.equal(bySeats.Lq, byCapacity.Lq);
  assert.equal(analyze({ ...base, waitingRoom: 4 }).Lq, mmck(30, 10, 2, 6).Lq);
});
