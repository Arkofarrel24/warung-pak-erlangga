/**
 * Bulk arrivals: a group that comes through the door all at once.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { solveDay } from '../src/analytic/transient.js';
import { ARRIVAL_OUTCOME, EVENT, QueueSimulation } from '../src/sim/engine.js';

const { SERVED, QUEUED, REJECTED } = ARRIVAL_OUTCOME;

function assertClose(actual, expected, tolerance = 1e-9, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, got ${actual}`,
  );
}

/** A generator that emits a fixed sequence; once it runs out there are no more events. */
function scripted(values) {
  let index = 0;
  return () => values[index++] ?? Infinity;
}

function collectEvents(simulation) {
  const events = [];
  for (let event = simulation.step(); event; event = simulation.step()) events.push(event);
  return events;
}

/**
 * One server and two waiting seats. A group of five arrives at 2.0 into an
 * empty warung: the first is served, two sit down, two are turned away.
 * Each service takes 1.0, so they leave at 3.0, 4.0, and 5.0.
 */
const groupTrace = () =>
  new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    waitingRoom: 2,
    closingTime: 8,
    periodLength: 2,
    batchArrivals: [{ time: 2, size: 5 }],
    sampleInterarrival: scripted([20]),
    sampleService: scripted([1, 1, 1]),
  });

test('a group is admitted one member at a time: servers first, then seats, then nobody', () => {
  const events = collectEvents(groupTrace());

  assert.deepEqual(
    events.map((event) => event.type),
    [EVENT.BATCH_ARRIVAL, EVENT.DEPARTURE, EVENT.DEPARTURE, EVENT.DEPARTURE, EVENT.CLOSE, EVENT.END],
  );
  const [group, first, second] = events;
  assertClose(group.time, 2);
  assert.deepEqual(
    group.arrivals.map((arrival) => arrival.outcome),
    [SERVED, QUEUED, QUEUED, REJECTED, REJECTED],
  );
  assert.equal(group.arrivals[0].serverIndex, 0);
  for (const arrival of group.arrivals) assertClose(arrival.customer.arrivalTime, 2);
  // The members who sat down are called in the order they came in.
  assert.equal(first.next.id, group.arrivals[1].customer.id);
  assert.equal(second.next.id, group.arrivals[2].customer.id);
});

test('a group is counted like any other customers', () => {
  const results = groupTrace().run();

  assert.equal(results.arrivals, 5);
  assert.equal(results.rejected, 2);
  assert.equal(results.served, 3);
  // Waits of those who got in: 0, 1.0, and 2.0.
  assertClose(results.Wq, 1);
  assertClose(results.totalQueueTime, 3);
  // All five are counted in the period in which the group arrived, 2-4.
  assert.deepEqual(
    results.periods.map((period) => period.arrivals),
    [0, 5, 0, 0],
  );
  assert.deepEqual(
    results.periods.map((period) => period.rejected),
    [0, 2, 0, 0],
  );
});

test('a group does not disturb the regular stream of arrivals', () => {
  // Common random numbers: the regular customers arrive at the same times
  // with or without the group.
  const config = { arrivalRate: 15, serviceRate: 10, servers: 2, waitingRoom: 4, patienceRate: 5, closingTime: 6, seed: 3 };
  const regularTimes = (overrides) =>
    collectEvents(new QueueSimulation({ ...config, ...overrides }))
      .filter((event) => event.type === EVENT.ARRIVAL)
      .map((event) => event.time);

  assert.deepEqual(regularTimes({ batchArrivals: [{ time: 2.5, size: 12 }] }), regularTimes({}));
});

test('every member of a group has a patience of their own', () => {
  const simulation = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    closingTime: 30,
    batchArrivals: [{ time: 1, size: 4 }],
    sampleInterarrival: scripted([50]),
    sampleService: scripted([10]),
    samplePatience: scripted([9, 2, 5, 3]),
  });
  const events = collectEvents(simulation);
  const reneges = events.filter((event) => event.type === EVENT.RENEGE);

  // The first is served for 10; the others give up after 2, 3, and 5.
  assert.deepEqual(
    reneges.map((event) => event.time),
    [3, 4, 6],
  );
  assert.equal(simulation.results.reneged, 3);
});

test('a group that comes after closing does not get in', () => {
  const results = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    closingTime: 5,
    batchArrivals: [
      { time: 5, size: 10 },
      { time: 7, size: 10 },
    ],
    sampleInterarrival: scripted([20]),
  }).run();

  assert.equal(results.arrivals, 0);
  assertClose(results.endTime, 5);
});

test('an invalid group is rejected', () => {
  const base = { arrivalRate: 8, serviceRate: 10, closingTime: 10 };
  const invalid = [
    'a group',
    [{ time: -1, size: 5 }],
    [{ time: 2, size: 0 }],
    [{ time: 2, size: 2.5 }],
    [{ time: Number.NaN, size: 5 }],
  ];
  for (const batchArrivals of invalid) {
    assert.throws(() => new QueueSimulation({ ...base, batchArrivals }), RangeError, JSON.stringify(batchArrivals));
  }
  assert.doesNotThrow(() => new QueueSimulation({ ...base, batchArrivals: [] }));
});

// ---------------------------------------------------------------------------
// The analytic solver
// ---------------------------------------------------------------------------

test('solver: a group into an empty warung fills the servers, then the seats', () => {
  // Nine people at t = 1, with two servers and four seats: two are served,
  // four sit down, three are turned away. Nobody else comes and nobody gives
  // up, so the six who got in are all served in the end.
  const result = solveDay({
    arrivalProfile: [{ time: 0, rate: 0.000001 }],
    serviceRate: 6,
    servers: 2,
    waitingRoom: 4,
    closingTime: 2,
    periodLength: 1,
    batchArrivals: [{ time: 1, size: 9 }],
  });

  assertClose(result.arrivals, 9, 1e-5);
  assertClose(result.rejected, 3, 1e-5);
  assertClose(result.served, 6, 1e-5);
  assertClose(result.periods[0].arrivals, 0, 1e-5);
  assertClose(result.periods[1].arrivals, 9, 1e-5);
  assertClose(result.periods[1].rejected, 3, 1e-5);
});

test('solver: a group at opening time walks into an empty warung', () => {
  const result = solveDay({
    arrivalProfile: [{ time: 0, rate: 0.000001 }],
    serviceRate: 6,
    servers: 3,
    waitingRoom: 1,
    closingTime: 2,
    batchArrivals: [{ time: 0, size: 5 }],
  });

  assertClose(result.rejected, 1, 1e-5);
  assertClose(result.served, 4, 1e-5);
});

/**
 * The statistical check, as in validation-day.test.js: a busy day with a
 * group of 14 arriving in the middle of it, simulated thousands of times
 * and compared with the solver's exact expectation.
 */
test('a simulated day with a group matches theory', () => {
  const DAYS = 6000;
  const day = {
    arrivalProfile: [
      { time: 0, rate: 8 },
      { time: 4, rate: 30 },
      { time: 8, rate: 12 },
    ],
    serviceRate: 12,
    servers: 2,
    waitingRoom: 3,
    patienceRate: 5,
    closingTime: 8,
    periodLength: 1,
    batchArrivals: [{ time: 2.5, size: 14 }],
  };
  const theory = solveDay(day);
  const sums = {};
  const squares = {};
  const track = (key, value) => {
    sums[key] = (sums[key] ?? 0) + value;
    squares[key] = (squares[key] ?? 0) + value * value;
  };

  for (let replication = 0; replication < DAYS; replication++) {
    const results = new QueueSimulation({ ...day, seed: 4242, replication }).run();
    for (const key of ['arrivals', 'served', 'reneged', 'rejected', 'totalQueueTime']) track(key, results[key]);
    // The hour in which the group arrives.
    track('groupHourRejected', results.periods[2].rejected);
    track('groupHourReneged', results.periods[2].reneged);
  }

  const expected = {
    arrivals: theory.arrivals,
    served: theory.served,
    reneged: theory.reneged,
    rejected: theory.rejected,
    totalQueueTime: theory.totalQueueTime,
    groupHourRejected: theory.periods[2].rejected,
    groupHourReneged: theory.periods[2].reneged,
  };
  for (const [key, value] of Object.entries(expected)) {
    const mean = sums[key] / DAYS;
    const variance = (squares[key] - DAYS * mean * mean) / (DAYS - 1);
    const apart = Math.abs(mean - value) / Math.sqrt(variance / DAYS);
    assert.ok(apart < 4, `${key}: theory ${value}, simulation ${mean} (${apart.toFixed(1)} standard errors)`);
  }
  // The group really is too large for the place: most of it is turned away at once.
  assert.ok(theory.periods[2].rejected > 5, `turned away in the group's hour: ${theory.periods[2].rejected}`);
});
