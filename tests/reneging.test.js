/**
 * Reneging: customers who join the line and leave it before being served.
 *
 * Three layers are tested here: cancelling an event in the future event
 * list, taking a customer out of the middle of the waiting line, and the
 * engine putting the two together.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ARRIVAL_OUTCOME, DISCIPLINE, EVENT, QueueSimulation } from '../src/sim/engine.js';
import { EventQueue } from '../src/sim/event-queue.js';
import { createRng } from '../src/sim/rng.js';
import { PRIORITY_CLASS, WaitingLine } from '../src/sim/waiting-line.js';

const TOLERANCE = 1e-9;

function assertClose(actual, expected, tolerance = TOLERANCE, label = '') {
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

// ---------------------------------------------------------------------------
// Future event list: cancelling
// ---------------------------------------------------------------------------

test('a cancelled event never comes out', () => {
  const fel = new EventQueue();
  fel.schedule(1, 'a');
  const doomed = fel.schedule(2, 'b');
  fel.schedule(3, 'c');

  assert.equal(fel.cancel(doomed), true);
  assert.equal(fel.size, 2);

  const order = [];
  while (fel.size > 0) order.push(fel.pop().type);
  assert.deepEqual(order, ['a', 'c']);
});

test('the earliest and the latest event can be cancelled too', () => {
  const fel = new EventQueue();
  const first = fel.schedule(1, 'first');
  fel.schedule(2, 'middle');
  const last = fel.schedule(3, 'last');

  assert.equal(fel.cancel(first), true);
  assert.equal(fel.peek().type, 'middle');
  assert.equal(fel.cancel(last), true);
  assert.equal(fel.pop().type, 'middle');
  assert.equal(fel.size, 0);
});

test('cancelling an event that is no longer in the list does nothing', () => {
  const fel = new EventQueue();
  const happened = fel.schedule(1, 'happened');
  const cancelled = fel.schedule(2, 'cancelled');
  fel.schedule(3, 'stays');

  fel.pop();
  assert.equal(fel.cancel(happened), false, 'it has already happened');
  assert.equal(fel.cancel(cancelled), true);
  assert.equal(fel.cancel(cancelled), false, 'it was already cancelled');
  assert.equal(fel.cancel(undefined), false);
  assert.equal(fel.size, 1);
  assert.equal(fel.pop().type, 'stays');
});

test('the order stays correct through many random cancellations', () => {
  const rng = createRng(11);
  const fel = new EventQueue();
  const pending = new Set();
  const popped = [];

  // A mix of what reneging causes: schedule, cancel from anywhere, take the earliest.
  for (let round = 0; round < 5000; round++) {
    const roll = rng();
    if (roll < 0.5 || pending.size === 0) {
      pending.add(fel.schedule(rng() * 100, 'X'));
    } else if (roll < 0.75) {
      const victim = [...pending][Math.floor(rng() * pending.size)];
      assert.equal(fel.cancel(victim), true);
      pending.delete(victim);
    } else {
      const event = fel.pop();
      // The event taken must be the earliest of everything still pending.
      for (const other of pending) assert.ok(event.time <= other.time);
      pending.delete(event);
    }
    assert.equal(fel.size, pending.size);
  }
  while (fel.size > 0) popped.push(fel.pop().time);
  assert.deepEqual(popped, [...popped].sort((a, b) => a - b));
});

// ---------------------------------------------------------------------------
// Waiting line: leaving from the middle
// ---------------------------------------------------------------------------

const { HIGH, REGULAR } = PRIORITY_CLASS;

function lineOf(discipline, entries) {
  const line = new WaitingLine(discipline);
  const customers = entries.map(([id, priorityClass]) => ({ id, priorityClass }));
  customers.forEach((customer) => line.push(customer));
  return { line, byId: Object.fromEntries(customers.map((customer) => [customer.id, customer])) };
}

function drain(line) {
  const ids = [];
  while (line.length > 0) ids.push(line.next().id);
  return ids;
}

const WAITING = [
  ['a', REGULAR],
  ['b', HIGH],
  ['c', REGULAR],
  ['d', HIGH],
];

test('a customer who leaves the line does not disturb the order of the rest', () => {
  const expected = {
    [DISCIPLINE.FIFO]: ['a', 'b', 'd'],
    [DISCIPLINE.LIFO]: ['d', 'b', 'a'],
    [DISCIPLINE.PRIORITY]: ['b', 'd', 'a'],
  };
  for (const discipline of Object.values(DISCIPLINE)) {
    const { line, byId } = lineOf(discipline, WAITING);

    assert.equal(line.remove(byId.c), true);
    assert.equal(line.length, 3);
    assert.deepEqual(line.peek(10).map((customer) => customer.id), expected[discipline]);
    assert.deepEqual(drain(line), expected[discipline], discipline);
  }
});

test('removing someone who is not in the line changes nothing', () => {
  const { line, byId } = lineOf(DISCIPLINE.FIFO, WAITING);

  assert.equal(line.next().id, 'a');
  assert.equal(line.remove(byId.a), false, 'already called to a server');
  assert.equal(line.remove({ id: 'stranger', priorityClass: REGULAR }), false);
  assert.equal(line.length, 3);
  assert.deepEqual(drain(line), ['b', 'c', 'd']);
});

test('the head and the tail of the line can leave too', () => {
  const { line, byId } = lineOf(DISCIPLINE.FIFO, WAITING);

  assert.equal(line.remove(byId.a), true);
  assert.equal(line.remove(byId.d), true);
  line.push({ id: 'e', priorityClass: REGULAR });
  assert.deepEqual(drain(line), ['b', 'c', 'e']);
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * A scenario that can be worked out by hand, one server:
 *
 *   A arrives at 1.0, service takes 4.0            -> leaves at 5.0
 *   B arrives at 2.0, patience 1.5                 -> gives up at 3.5
 *   C arrives at 3.0, patience 10, waits until 5.0 -> service 1.0, leaves at 6.0
 *   D arrives at 5.5, patience 0.2                 -> gives up at 5.7
 *
 *   time     0   1.0  2.0  3.0  3.5     5.0  5.5  5.7  6.0     8.0
 *   waiting  | 0 | 0  | 1  | 2  |   1   | 0  | 1  | 0  |   0   |
 *   busy     | 0 |              1                      |   0   |
 */
const HAND_TRACE = { arrivalRate: 1, serviceRate: 1, servers: 1, duration: 8 };
const handTrace = (overrides = {}) =>
  new QueueSimulation({
    ...HAND_TRACE,
    sampleInterarrival: scripted([1.0, 1.0, 1.0, 2.5]),
    sampleService: scripted([4.0, 1.0]),
    // One patience per arriving customer, in order of arrival. A is served at
    // once, so the 9 is drawn but never used.
    samplePatience: scripted([9, 1.5, 10, 0.2]),
    ...overrides,
  });

test('reneging: the event trace matches the hand calculation', () => {
  const simulation = handTrace();
  const events = collectEvents(simulation);

  assert.deepEqual(
    events.map((event) => event.type),
    [
      EVENT.ARRIVAL,
      EVENT.ARRIVAL,
      EVENT.ARRIVAL,
      EVENT.RENEGE,
      EVENT.DEPARTURE,
      EVENT.ARRIVAL,
      EVENT.RENEGE,
      EVENT.DEPARTURE,
      EVENT.END,
    ],
  );
  [1.0, 2.0, 3.0, 3.5, 5.0, 5.5, 5.7, 6.0, 8.0].forEach((time, i) =>
    assertClose(events[i].time, time, TOLERANCE, `event ${i}`),
  );

  const [arrivalA, arrivalB, arrivalC, renegeB, departureA, arrivalD, renegeD, departureC] = events;
  assert.equal(arrivalA.outcome, ARRIVAL_OUTCOME.SERVED);
  assert.equal(arrivalB.outcome, ARRIVAL_OUTCOME.QUEUED);
  assert.equal(renegeB.customer.id, arrivalB.customer.id);
  assertClose(renegeB.customer.renegedAt, 3.5);
  assert.equal(renegeB.customer.serviceStart, null, 'B was never served');

  // B stood ahead of C. With B gone, C is the one called when A leaves.
  assert.equal(departureA.next.id, arrivalC.customer.id);
  assertClose(arrivalC.customer.serviceStart, 5.0);
  assert.equal(arrivalC.customer.renegedAt, null);

  assert.equal(renegeD.customer.id, arrivalD.customer.id);
  assert.equal(departureC.next, null, 'D gave up before the server became free');
});

test('reneging: the statistics match the hand calculation', () => {
  const results = handTrace().run();

  // Area under the number waiting: 1(1.0) + 2(0.5) + 1(1.5) + 1(0.2) = 3.7
  assertClose(results.Lq, 3.7 / 8, TOLERANCE, 'Lq');
  // The server is busy on [1.0, 6.0]
  assertClose(results.rho, 5 / 8, TOLERANCE, 'rho');
  assertClose(results.L, (5 + 3.7) / 8, TOLERANCE, 'L');
  // Empty on [0, 1.0] and [6.0, 8.0]
  assertClose(results.P0, 3 / 8, TOLERANCE, 'P0');

  assert.equal(results.arrivals, 4);
  assert.equal(results.served, 2);
  assert.equal(results.reneged, 2);
  assert.equal(results.rejected, 0);
  assertClose(results.renegeRate, 0.5);

  // Served customers: A waited 0, C waited 2.0
  assertClose(results.Wq, 1.0, TOLERANCE, 'Wq of those served');
  // Customers who gave up waited exactly as long as their patience: 1.5 and 0.2
  assertClose(results.WqReneged, 0.85, TOLERANCE, 'Wq of those who gave up');
  assertClose(results.WqAll, (0 + 2.0 + 1.5 + 0.2) / 4, TOLERANCE, 'Wq of everyone');
  // A spent 4.0 in the system and C 3.0
  assertClose(results.W, 3.5, TOLERANCE, 'W');

  // Little's law holds exactly here, because every customer's visit is over:
  // Lq = λ_eff · WqAll, with λ_eff = 4 customers / 8 time units.
  assertClose(results.Lq, results.effectiveArrivalRate * results.WqAll, TOLERANCE, "Little's law");
});

test('a customer called in time has their renege event cancelled', () => {
  const simulation = handTrace();
  simulation.run();

  // C was called at 5.0 with patience lasting until 13.0. If that event were
  // still in the list, it would be the one left over after the run.
  assert.equal(simulation.fel.size, 0);
});

test('every customer draws a patience, including those who never wait', () => {
  const simulation = handTrace();
  const arrivals = collectEvents(simulation).filter((event) => event.type === EVENT.ARRIVAL);

  assert.deepEqual(
    arrivals.map((event) => event.customer.patience),
    [9, 1.5, 10, 0.2],
  );
});

test('without reneging, patience is unlimited and nobody gives up', () => {
  const results = new QueueSimulation({
    arrivalRate: 30,
    serviceRate: 5,
    servers: 2,
    duration: 50,
    seed: 4,
  }).run();

  assert.equal(results.reneged, 0);
  assert.ok(results.Lq > 50, 'the line just keeps growing');
});

test('reneging keeps an overloaded system from growing without bound', () => {
  // λ = 30 against a service capacity of cμ = 10: without reneging the line
  // would grow by about 20 customers per hour, forever.
  const config = { arrivalRate: 30, serviceRate: 5, servers: 2, duration: 400, warmup: 50, seed: 4 };
  const results = new QueueSimulation({ ...config, patienceRate: 4 }).run();

  // Flow conservation: what does not get served has to leave as reneging,
  // about λ - cμ = 20 per hour, so Lq settles near 20/θ = 5.
  assert.ok(results.Lq > 4 && results.Lq < 6, `Lq ${results.Lq}`);
  assert.ok(results.renegeRate > 0.6 && results.renegeRate < 0.72, `renege rate ${results.renegeRate}`);
});

test('reneging does not change who arrives when', () => {
  // Common random numbers: patience has its own random stream, so the
  // arrival times are the same with and without reneging.
  const config = { arrivalRate: 12, serviceRate: 10, duration: 50, seed: 8 };
  const arrivalTimes = (overrides) =>
    collectEvents(new QueueSimulation({ ...config, ...overrides }))
      .filter((event) => event.type === EVENT.ARRIVAL)
      .map((event) => event.time);

  assert.deepEqual(arrivalTimes({ patienceRate: 6 }), arrivalTimes({}));
});

test('reneging works under every queue discipline', () => {
  for (const discipline of Object.values(DISCIPLINE)) {
    const simulation = new QueueSimulation({
      arrivalRate: 20,
      serviceRate: 8,
      servers: 2,
      discipline,
      patienceRate: 5,
      waitingRoom: 6,
      duration: 300,
      seed: 3,
    });
    let renegeEvents = 0;
    for (let event = simulation.step(); event; event = simulation.step()) {
      if (event.type !== EVENT.RENEGE) continue;
      renegeEvents++;
      assert.equal(event.customer.serviceStart, null, 'only waiting customers give up');
      assertClose(event.time - event.customer.arrivalTime, event.customer.patience, 1e-9);
    }
    const results = simulation.results;

    assert.ok(renegeEvents > 0);
    assert.equal(results.reneged, renegeEvents);
    // Every arriving customer was turned away, gave up, was served, or is still inside.
    assert.equal(
      results.arrivals,
      results.rejected + results.reneged + results.served + simulation.numberInSystem,
      discipline,
    );
  }
});

test('an invalid patience rate is rejected', () => {
  const valid = { arrivalRate: 8, serviceRate: 10, duration: 100 };
  for (const patienceRate of [-1, Number.NaN, Infinity]) {
    assert.throws(() => new QueueSimulation({ ...valid, patienceRate }), RangeError);
  }
});
