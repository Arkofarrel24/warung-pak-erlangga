/**
 * A limited stock: every service uses up one portion, and when the last one
 * goes the warung is sold out.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ARRIVAL_OUTCOME, EVENT, QueueSimulation } from '../src/sim/engine.js';

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

/**
 * One server, two portions, the doors close at 5.0:
 *
 *   A arrives at 1.0, service 2.0            -> portion 1, leaves at 3.0
 *   B arrives at 1.5, waits until 3.0        -> portion 2, the last one
 *   C arrives at 2.0, still waiting at 3.0   -> sent away: nothing is left
 *   D arrives at 3.5                         -> turned back at the door
 *   B's service takes 1.0                    -> leaves at 4.0
 */
const stockTrace = () =>
  new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    stock: 2,
    closingTime: 5,
    sampleInterarrival: scripted([1.0, 0.5, 0.5, 1.5, 9]),
    sampleService: scripted([2.0, 1.0]),
  });

test('selling out: the event trace matches the hand calculation', () => {
  const simulation = stockTrace();
  const events = collectEvents(simulation);

  assert.deepEqual(
    events.map((event) => event.type),
    [
      EVENT.ARRIVAL,
      EVENT.ARRIVAL,
      EVENT.ARRIVAL,
      EVENT.DEPARTURE,
      EVENT.SOLD_OUT,
      EVENT.ARRIVAL,
      EVENT.DEPARTURE,
      EVENT.CLOSE,
      EVENT.END,
    ],
  );
  [1.0, 1.5, 2.0, 3.0, 3.0, 3.5, 4.0, 5.0, 5.0].forEach((time, i) =>
    assertClose(events[i].time, time, TOLERANCE, `event ${i}`),
  );

  const [, arrivalB, arrivalC, departureA, soldOut, arrivalD, departureB] = events;
  assert.equal(departureA.next.id, arrivalB.customer.id, 'B gets the last portion');
  assert.deepEqual(
    soldOut.dismissed.map((customer) => customer.id),
    [arrivalC.customer.id],
  );
  assertClose(arrivalC.customer.dismissedAt, 3.0);
  assert.equal(arrivalC.customer.serviceStart, null);
  assert.equal(arrivalD.outcome, ARRIVAL_OUTCOME.SOLD_OUT);
  assert.equal(departureB.next, null);
  assert.equal(simulation.stock, 0);
});

test('selling out: the statistics match the hand calculation', () => {
  const results = stockTrace().run();

  assert.equal(results.arrivals, 4);
  assert.equal(results.served, 2);
  assert.equal(results.soldOutInLine, 1);
  assert.equal(results.soldOutAtDoor, 1);
  assert.equal(results.soldOut, 2);
  assert.equal(results.stockLeft, 0);
  assertClose(results.soldOutAt, 3.0);

  // Waits: A 0, B 1.5, C 1.0 (sent away). D never got in.
  assertClose(results.Wq, 1.5 / 2, TOLERANCE, 'Wq of those served');
  assertClose(results.WqAll, 2.5 / 3, TOLERANCE, 'Wq of everyone who got in');
  assertClose(results.totalQueueTime, 2.5, TOLERANCE, 'queue time');
  // Three customers got in during 5 hours, and Little's law still holds.
  assertClose(results.effectiveArrivalRate, 3 / 5);
  assertClose(results.Lq, results.effectiveArrivalRate * results.WqAll, TOLERANCE, "Little's law");
});

test('the customer who takes the last portion can be one who walks straight in', () => {
  const simulation = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    stock: 1,
    closingTime: 5,
    sampleInterarrival: scripted([1.0, 0.5, 9]),
    sampleService: scripted([2.0]),
  });
  const events = collectEvents(simulation);

  assert.deepEqual(
    events.map((event) => event.type),
    [EVENT.ARRIVAL, EVENT.SOLD_OUT, EVENT.ARRIVAL, EVENT.DEPARTURE, EVENT.CLOSE, EVENT.END],
  );
  assert.equal(events[0].outcome, ARRIVAL_OUTCOME.SERVED);
  assert.deepEqual(events[1].dismissed, [], 'nobody was waiting');
  assert.equal(events[2].outcome, ARRIVAL_OUTCOME.SOLD_OUT);
});

test('new staff cannot serve more customers than there are portions', () => {
  // Nobody is on duty until 2.0, by which time three customers are waiting
  // for the single portion.
  const simulation = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    staffSchedule: [
      { time: 0, servers: 0 },
      { time: 2, servers: 3 },
    ],
    stock: 1,
    closingTime: 5,
    sampleInterarrival: scripted([0.5, 0.5, 0.5, 9]),
    sampleService: scripted([1.0]),
  });
  const events = collectEvents(simulation);
  const staffChange = events.find((event) => event.type === EVENT.STAFF_CHANGE);
  const soldOut = events.find((event) => event.type === EVENT.SOLD_OUT);

  assert.equal(staffChange.started.length, 1);
  assert.equal(soldOut.dismissed.length, 2);
  assert.equal(simulation.results.served, 1);
});

test('with no stock at all, everyone is turned back at the door', () => {
  const results = new QueueSimulation({
    arrivalRate: 20,
    serviceRate: 10,
    stock: 0,
    closingTime: 5,
    seed: 3,
  }).run();

  assert.ok(results.arrivals > 50);
  assert.equal(results.served, 0);
  assert.equal(results.soldOutAtDoor, results.arrivals);
  assert.equal(results.overtime, 0);
});

/**
 * The property that makes stock easy to reason about: until the last portion
 * goes, a day with limited stock is exactly the day with unlimited stock. So
 * with the same random numbers (common random numbers),
 *
 *   portions sold = min(N, stock)
 *
 * where N is the number of customers that same day would have served with
 * unlimited stock. This is the "demand" of the newsvendor model.
 */
test('portions sold = min(what the day would have served, stock), exactly', () => {
  const day = {
    arrivalProfile: [
      { time: 0, rate: 8 },
      { time: 4, rate: 32 },
      { time: 8, rate: 10 },
      { time: 12, rate: 20 },
    ],
    serviceRate: 12,
    servers: 2,
    waitingRoom: 4,
    patienceRate: 5,
    closingTime: 12,
    periodLength: 1,
  };

  for (const replication of [0, 1, 2, 3, 4]) {
    const unlimited = new QueueSimulation({ ...day, seed: 99, replication });
    const serviceStarts = [];
    for (let event = unlimited.step(); event; event = unlimited.step()) {
      if (event.type === EVENT.ARRIVAL && event.outcome === ARRIVAL_OUTCOME.SERVED) {
        serviceStarts.push(event.time);
      } else if (event.type === EVENT.DEPARTURE && event.next) {
        serviceStarts.push(event.time);
      }
    }
    const demand = unlimited.results.served;
    assert.equal(serviceStarts.length, demand);

    for (const stock of [1, 40, Math.floor(demand / 2), demand - 1, demand, demand + 1, demand + 50]) {
      const results = new QueueSimulation({ ...day, seed: 99, replication, stock }).run();
      const label = `day ${replication}, stock ${stock}, demand ${demand}`;

      assert.equal(results.served, Math.min(demand, stock), label);
      assert.equal(results.stockLeft, Math.max(stock - demand, 0), label);
      if (stock <= demand) {
        // It sells out at the moment the unlimited day starts its stock-th service.
        assert.equal(results.soldOutAt, serviceStarts[stock - 1], label);
      } else {
        assert.equal(results.soldOutAt, null, label);
        assert.equal(results.soldOut, 0, label);
      }
      // Every customer is turned away, gives up, is served, or finds nothing left.
      assert.equal(
        results.arrivals,
        results.rejected + results.reneged + results.served + results.soldOut,
        label,
      );
      assert.equal(
        results.periods.reduce((total, period) => total + period.soldOut, 0),
        results.soldOut,
        label,
      );
    }
  }
});

test('an invalid stock is rejected', () => {
  const base = { arrivalRate: 8, serviceRate: 10, closingTime: 10 };
  for (const stock of [-1, 2.5, Number.NaN]) {
    assert.throws(() => new QueueSimulation({ ...base, stock }), RangeError, String(stock));
  }
  assert.doesNotThrow(() => new QueueSimulation({ ...base, stock: 0 }));
  assert.doesNotThrow(() => new QueueSimulation({ ...base, stock: Infinity }));
});
