/**
 * Validation of a whole simulated day against the Kolmogorov forward
 * equations.
 *
 * This is the test that covers everything the game adds to the engine at
 * once: an arrival rate that changes during the day (thinning), balking at a
 * full waiting room, reneging, a staff schedule that goes up and down, and a
 * closing time after which the customers inside are cleared.
 *
 * A day is short, so there is no steady state to compare with. Instead the
 * same day is simulated thousands of times with different random numbers
 * (independent replications), and the average over those days is compared
 * with the exact expectation from the transient solver. The solver itself is
 * tested against known exact results in transient.test.js.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { solveDay } from '../src/analytic/transient.js';
import { QueueSimulation } from '../src/sim/engine.js';
import { DAY_CASE, DAY_RUN } from './reference-cases-day.js';

const MAX_STANDARD_ERRORS = 4;
const MAX_RELATIVE_ERROR = 0.02;

const TOTALS = [
  'arrivals',
  'rejected',
  'reneged',
  'served',
  'totalQueueTime',
  'totalBusyTime',
  'totalStaffedTime',
  'overtime',
];
const PER_PERIOD = [
  'arrivals',
  'rejected',
  'reneged',
  'served',
  'totalQueueTime',
  'totalBusyTime',
  'totalStaffedTime',
];

/** Running mean and variance of one quantity over the replications. */
class Sample {
  #n = 0;
  #sum = 0;
  #sumSquares = 0;

  add(value) {
    this.#n++;
    this.#sum += value;
    this.#sumSquares += value * value;
  }

  get mean() {
    return this.#sum / this.#n;
  }

  /** Standard error of the mean: s / √n. */
  get standardError() {
    const variance = (this.#sumSquares - this.#n * this.mean ** 2) / (this.#n - 1);
    return Math.sqrt(Math.max(variance, 0) / this.#n);
  }
}

function simulateDays() {
  const openHours = DAY_CASE.closingTime / DAY_CASE.periodLength;
  const totals = Object.fromEntries(TOTALS.map((key) => [key, new Sample()]));
  const hourly = Array.from({ length: openHours }, () =>
    Object.fromEntries(PER_PERIOD.map((key) => [key, new Sample()])),
  );
  // Everything that happens after closing, as one "after hours" period.
  const afterHours = Object.fromEntries(PER_PERIOD.map((key) => [key, new Sample()]));
  let unfinished = 0;

  for (let day = 0; day < DAY_RUN.replications; day++) {
    const results = new QueueSimulation({ ...DAY_CASE, seed: DAY_RUN.seed, replication: day }).run();
    if (results.leftInSystem > 0) unfinished++;

    for (const key of TOTALS) totals[key].add(results[key]);
    for (const key of PER_PERIOD) {
      let later = 0;
      results.periods.forEach((period, hour) => {
        if (hour >= openHours) later += period[key];
      });
      for (let hour = 0; hour < openHours; hour++) {
        hourly[hour][key].add(results.periods[hour]?.[key] ?? 0);
      }
      afterHours[key].add(later);
    }
  }
  return { totals, hourly, afterHours, unfinished };
}

function standardErrorsApart(sample, expected) {
  // Some quantities are not random at all: in an hour without a shift change
  // the staff time is simply c x 1 hour in every replication. Their standard
  // error is zero, so they are compared directly, up to rounding.
  if (Math.abs(sample.mean - expected) < 1e-9) return 0;
  return Math.abs(sample.mean - expected) / sample.standardError;
}

function assertWithin(label, sample, expected) {
  const apart = standardErrorsApart(sample, expected);
  assert.ok(
    apart < MAX_STANDARD_ERRORS,
    `${label}: theory ${expected}, simulation ${sample.mean} (${apart.toFixed(1)} standard errors)`,
  );
}

const theory = solveDay(DAY_CASE);
const simulated = simulateDays();

test('the day case exercises every feature', () => {
  assert.ok(theory.rejected > 5, `turned away: ${theory.rejected}`);
  assert.ok(theory.reneged > 5, `gave up: ${theory.reneged}`);
  assert.ok(theory.overtime > 0.01, `overtime: ${theory.overtime}`);
  assert.ok(
    theory.periods.some((period) => period.trafficIntensity > 0.99),
    'at least one hour runs at full load',
  );
  assert.ok(
    theory.periods.some((period) => period.trafficIntensity < 0.5),
    'at least one hour is quiet',
  );
  assert.equal(simulated.unfinished, 0, 'every simulated day runs until the warung is empty');
});

test('a simulated day matches theory: totals', () => {
  for (const key of TOTALS) assertWithin(key, simulated.totals[key], theory[key]);

  // For the large totals the estimate is sharp enough for the 2% rule of the
  // other validation tests to apply as well.
  for (const key of ['arrivals', 'served', 'totalBusyTime', 'totalStaffedTime', 'totalQueueTime']) {
    const relativeError = Math.abs(simulated.totals[key].mean - theory[key]) / theory[key];
    assert.ok(relativeError < MAX_RELATIVE_ERROR, `${key}: off by ${(relativeError * 100).toFixed(2)}%`);
  }
});

test('the comparison is sharp, not passed thanks to wide error bars', () => {
  // Standard error as a share of the expected value, for the two kinds of
  // lost customers. If these were large, agreeing with theory would mean little.
  for (const key of ['rejected', 'reneged']) {
    const share = simulated.totals[key].standardError / theory[key];
    assert.ok(share < 0.01, `${key}: standard error is ${(share * 100).toFixed(2)}% of the mean`);
  }
});

test('a simulated day matches theory: every hour', () => {
  simulated.hourly.forEach((samples, hour) => {
    for (const key of PER_PERIOD) {
      assertWithin(`hour ${hour}, ${key}`, samples[key], theory.periods[hour][key]);
    }
  });
});

test('a simulated day matches theory: after closing', () => {
  const openHours = simulated.hourly.length;
  for (const key of PER_PERIOD) {
    const expected = theory.periods.slice(openHours).reduce((total, period) => total + period[key], 0);
    assertWithin(`after hours, ${key}`, simulated.afterHours[key], expected);
  }
});

test('every simulated customer is turned away, gives up, or is served', () => {
  const { arrivals, rejected, reneged, served } = simulated.totals;
  assert.ok(Math.abs(arrivals.mean - rejected.mean - reneged.mean - served.mean) < 1e-9);
});
