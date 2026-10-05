/**
 * One day as a terminating simulation: a closing time, a number of servers
 * that changes during the day, and statistics per period.
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

const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);

// ---------------------------------------------------------------------------
// Closing time
// ---------------------------------------------------------------------------

/**
 * One server, the doors close at 5.0:
 *
 *   A arrives at 1.0, service 2.0                 -> leaves at 3.0
 *   B arrives at 4.0, service 3.0                 -> leaves at 7.0
 *   C arrives at 4.5, waits until 7.0, service 1.5 -> leaves at 8.5
 *   D would arrive at 5.2, after closing          -> never comes in
 */
const closingTrace = (overrides = {}) =>
  new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    closingTime: 5,
    sampleInterarrival: scripted([1.0, 3.0, 0.5, 0.7]),
    sampleService: scripted([2.0, 3.0, 1.5]),
    ...overrides,
  });

test('after closing nobody arrives, and the customers inside are still served', () => {
  const simulation = closingTrace();
  const events = collectEvents(simulation);

  assert.deepEqual(
    events.map((event) => event.type),
    [
      EVENT.ARRIVAL,
      EVENT.DEPARTURE,
      EVENT.ARRIVAL,
      EVENT.ARRIVAL,
      EVENT.CLOSE,
      EVENT.DEPARTURE,
      EVENT.DEPARTURE,
      EVENT.END,
    ],
  );
  [1.0, 3.0, 4.0, 4.5, 5.0, 7.0, 8.5, 8.5].forEach((time, i) =>
    assertClose(events[i].time, time, TOLERANCE, `event ${i}`),
  );

  assert.equal(simulation.closed, true);
  assert.equal(simulation.finished, true);
  assert.equal(simulation.numberInSystem, 0);
  assert.equal(simulation.step(), null);
});

test('the day ends when the last customer leaves, and that is reported as overtime', () => {
  const results = closingTrace().run();

  assertClose(results.endTime, 8.5);
  assertClose(results.overtime, 3.5);
  assert.equal(results.arrivals, 3);
  assert.equal(results.served, 3);
  assert.equal(results.leftInSystem, 0);
  // Waits: A 0, B 0, C 2.5. Times in the system: A 2.0, B 3.0, C 4.0.
  assertClose(results.Wq, 2.5 / 3, TOLERANCE, 'Wq');
  assertClose(results.W, 3.0, TOLERANCE, 'W');
  // Nobody is cut off, so Little's law holds exactly for the whole day.
  assertClose(results.Lq, results.effectiveArrivalRate * results.WqAll, TOLERANCE, "Little's law");
  assertClose(results.L, results.effectiveArrivalRate * results.W, TOLERANCE, "Little's law, L");
});

test('a day that closes on an empty warung ends at the closing time', () => {
  const simulation = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    closingTime: 5,
    sampleInterarrival: scripted([1.0, 8.0]),
    sampleService: scripted([1.0]),
  });
  const events = collectEvents(simulation);

  assert.deepEqual(
    events.map((event) => event.type),
    [EVENT.ARRIVAL, EVENT.DEPARTURE, EVENT.CLOSE, EVENT.END],
  );
  assertClose(simulation.results.endTime, 5);
  assert.equal(simulation.results.overtime, 0);
});

test('customers still give up waiting after the doors have closed', () => {
  // A is served from 4.0 to 9.0. B arrives at 4.5 with patience 2.0 and gives
  // up at 6.5, after closing at 5.0.
  const simulation = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    closingTime: 5,
    sampleInterarrival: scripted([4.0, 0.5]),
    sampleService: scripted([5.0]),
    samplePatience: scripted([1, 2.0]),
  });
  const events = collectEvents(simulation);

  assert.deepEqual(
    events.map((event) => event.type),
    [EVENT.ARRIVAL, EVENT.ARRIVAL, EVENT.CLOSE, EVENT.RENEGE, EVENT.DEPARTURE, EVENT.END],
  );
  assertClose(events[3].time, 6.5);
  assertClose(simulation.results.endTime, 9.0);
  assert.equal(simulation.results.reneged, 1);
});

test('a run length on top of a closing time is a hard stop', () => {
  const simulation = closingTrace({ duration: 6 });
  const results = simulation.run();

  // At 6.0 B is still being served and C is still waiting.
  assertClose(results.endTime, 6);
  assert.equal(results.leftInSystem, 2);
  assert.equal(results.served, 1);
});

test('every arrival of a random day falls before the closing time and is accounted for', () => {
  const closingTime = 10;
  const simulation = new QueueSimulation({
    arrivalRate: 30,
    serviceRate: 8,
    servers: 3,
    waitingRoom: 5,
    patienceRate: 6,
    closingTime,
    seed: 77,
  });
  let lastArrival = 0;
  for (let event = simulation.step(); event; event = simulation.step()) {
    if (event.type === EVENT.ARRIVAL) lastArrival = event.time;
  }
  const results = simulation.results;

  assert.ok(lastArrival < closingTime);
  assert.ok(results.endTime >= closingTime);
  assert.ok(results.rejected > 0 && results.reneged > 0 && results.served > 0);
  assert.equal(results.leftInSystem, 0);
  assert.equal(results.arrivals, results.rejected + results.reneged + results.served);
});

test('an invalid closing time is rejected', () => {
  const base = { arrivalRate: 8, serviceRate: 10 };

  assert.throws(() => new QueueSimulation({ ...base, closingTime: 0 }), RangeError);
  assert.throws(() => new QueueSimulation({ ...base, closingTime: -2 }), RangeError);
  assert.throws(() => new QueueSimulation({ ...base, closingTime: 10, duration: 8 }), RangeError);
  assert.throws(() => new QueueSimulation(base), RangeError, 'neither a run length nor a closing time');
  assert.doesNotThrow(() => new QueueSimulation({ ...base, closingTime: 10 }));
  assert.doesNotThrow(() => new QueueSimulation({ ...base, closingTime: 10, duration: 12 }));
});

// ---------------------------------------------------------------------------
// Staff schedule
// ---------------------------------------------------------------------------

/**
 * One server until 4.0, two until 8.0, then one again. The doors close at 12.
 *
 *   A arrives at 1.0, service 5.0 on server 0      -> leaves at 6.0
 *   B arrives at 2.0 and waits
 *   C arrives at 3.0 and waits
 *   4.0  a second server comes on duty and calls B at once (service 6.0 -> 10.0)
 *   6.0  A leaves; server 0 calls C (service 3.5 -> 9.5)
 *   8.0  the schedule drops to one server, but both are in the middle of a
 *        service and nobody is interrupted
 *   D arrives at 8.5: one server is on duty and two are busy, so D waits
 *   9.5  C leaves; server 0 is the one going home, so it does not call D
 *   10.0 B leaves; server 1 calls D (service 1.0 -> 11.0)
 *
 *   time     0   1   2   3   4       6       8   8.5  9.5  10   11   12
 *   on duty  |       1       |       2       |           1          |
 *   busy     | 0 |     1     |           2             | 1  | 1  | 0 |
 *   waiting  | 0 | 0 | 1 | 2 |   1   |   0   | 0 |  1       | 0      |
 */
const SCHEDULE = [
  { time: 0, servers: 1 },
  { time: 4, servers: 2 },
  { time: 8, servers: 1 },
];
const scheduleTrace = (overrides = {}) =>
  new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    staffSchedule: SCHEDULE,
    closingTime: 12,
    sampleInterarrival: scripted([1.0, 1.0, 1.0, 5.5]),
    sampleService: scripted([5.0, 6.0, 3.5, 1.0]),
    ...overrides,
  });

test('staff schedule: the event trace matches the hand calculation', () => {
  const simulation = scheduleTrace();
  const events = collectEvents(simulation);

  assert.deepEqual(
    events.map((event) => event.type),
    [
      EVENT.ARRIVAL,
      EVENT.ARRIVAL,
      EVENT.ARRIVAL,
      EVENT.STAFF_CHANGE,
      EVENT.DEPARTURE,
      EVENT.STAFF_CHANGE,
      EVENT.ARRIVAL,
      EVENT.DEPARTURE,
      EVENT.DEPARTURE,
      EVENT.DEPARTURE,
      EVENT.CLOSE,
      EVENT.END,
    ],
  );
  [1, 2, 3, 4, 6, 8, 8.5, 9.5, 10, 11, 12, 12].forEach((time, i) =>
    assertClose(events[i].time, time, TOLERANCE, `event ${i}`),
  );

  const [arrivalA, arrivalB, arrivalC, moreStaff, departureA, lessStaff, arrivalD, departureC, departureB] =
    events;

  // More staff: the newcomer calls the head of the line at once.
  assert.equal(moreStaff.servers, 2);
  assert.equal(moreStaff.started.length, 1);
  assert.equal(moreStaff.started[0].customer.id, arrivalB.customer.id);
  assert.equal(moreStaff.started[0].serverIndex, 1);
  assertClose(arrivalB.customer.serviceStart, 4.0);

  assert.equal(departureA.customer.id, arrivalA.customer.id);
  assert.equal(departureA.next.id, arrivalC.customer.id);
  assert.equal(departureA.serverLeft, false);

  // Less staff: nobody is interrupted, and nobody new is called.
  assert.equal(lessStaff.servers, 1);
  assert.deepEqual(lessStaff.started, []);
  assertClose(arrivalC.customer.serviceEnd, 9.5, TOLERANCE, 'C is served to the end');

  // D finds one server on duty and two busy, and has to wait.
  assert.equal(arrivalD.outcome, ARRIVAL_OUTCOME.QUEUED);
  // The server whose shift is over goes home instead of calling D.
  assert.equal(departureC.serverLeft, true);
  assert.equal(departureC.next, null);
  // The server still on duty calls D.
  assert.equal(departureB.serverLeft, false);
  assert.equal(departureB.next.id, arrivalD.customer.id);
  assertClose(arrivalD.customer.serviceStart, 10.0);
});

test('staff schedule: the statistics match the hand calculation', () => {
  const results = scheduleTrace().run();

  // Busy server time: A 5.0 + B 6.0 + C 3.5 + D 1.0
  assertClose(results.totalBusyTime, 15.5, TOLERANCE, 'busy time');
  // Server time at their post: 1 x 4 + 2 x 4, then on [8, 9.5] two servers
  // are still there (one past the end of its shift), then 1 x 2.5.
  assertClose(results.totalStaffedTime, 4 + 8 + 3 + 2.5, TOLERANCE, 'staffed time');
  assertClose(results.rho, 15.5 / 17.5, TOLERANCE, 'rho');
  // Waiting: B 2.0 + C 3.0 + D 1.5
  assertClose(results.totalQueueTime, 6.5, TOLERANCE, 'queue time');
  assertClose(results.Wq, 6.5 / 4, TOLERANCE, 'Wq');
  assert.equal(results.served, 4);
  assertClose(results.endTime, 12);
  assert.equal(results.overtime, 0);
});

test('staff schedule: the statistics per period match the hand calculation', () => {
  const { periods, ...totals } = scheduleTrace({ periodLength: 4 }).run();

  assert.equal(periods.length, 3);
  assert.deepEqual(
    periods.map((period) => [period.from, period.to]),
    [
      [0, 4],
      [4, 8],
      [8, 12],
    ],
  );

  const [morning, midday, evening] = periods;
  // 0-4: A, B, C arrive. A is served from 1.0; B waits 2.0 and C 1.0 so far.
  assert.equal(morning.arrivals, 3);
  assert.equal(morning.served, 0);
  assertClose(morning.totalBusyTime, 3);
  assertClose(morning.totalStaffedTime, 4);
  assertClose(morning.rho, 3 / 4);
  assertClose(morning.totalQueueTime, 3);
  assertClose(morning.Lq, 3 / 4);
  assertClose(morning.staff, 1);
  // Only A started service in this period, without waiting.
  assert.equal(morning.Wq, 0);

  // 4-8: B is called at 4.0 (waited 2.0) and C at 6.0 (waited 3.0). A leaves.
  assert.equal(midday.arrivals, 0);
  assert.equal(midday.served, 1);
  assertClose(midday.totalBusyTime, 8);
  assertClose(midday.totalStaffedTime, 8);
  assertClose(midday.rho, 1);
  assertClose(midday.totalQueueTime, 2);
  assertClose(midday.Wq, 2.5);
  assertClose(midday.staff, 2);

  // 8-12: D arrives and waits 1.5. C, B, and D leave.
  assert.equal(evening.arrivals, 1);
  assert.equal(evening.served, 3);
  assertClose(evening.totalBusyTime, 4.5);
  assertClose(evening.totalStaffedTime, 5.5);
  assertClose(evening.totalQueueTime, 1.5);
  assertClose(evening.Wq, 1.5);

  // The periods add up to the day.
  assert.equal(sum(periods, 'arrivals'), totals.arrivals);
  assert.equal(sum(periods, 'served'), totals.served);
  assertClose(sum(periods, 'totalBusyTime'), totals.totalBusyTime);
  assertClose(sum(periods, 'totalStaffedTime'), totals.totalStaffedTime);
  assertClose(sum(periods, 'totalQueueTime'), totals.totalQueueTime);
});

test('with nobody on duty, customers wait until staff arrive or their patience runs out', () => {
  // Nobody on duty until 2.0. A arrives at 0.5 with patience 1.0 and gives up
  // at 1.5. B arrives at 1.8 with patience 5 and is called at 2.0.
  const simulation = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    staffSchedule: [
      { time: 0, servers: 0 },
      { time: 2, servers: 1 },
    ],
    closingTime: 4,
    sampleInterarrival: scripted([0.5, 1.3]),
    sampleService: scripted([1.0]),
    samplePatience: scripted([1.0, 5]),
  });
  const events = collectEvents(simulation);

  assert.deepEqual(
    events.map((event) => event.type),
    [
      EVENT.ARRIVAL,
      EVENT.RENEGE,
      EVENT.ARRIVAL,
      EVENT.STAFF_CHANGE,
      EVENT.DEPARTURE,
      EVENT.CLOSE,
      EVENT.END,
    ],
  );
  assert.equal(events[0].outcome, ARRIVAL_OUTCOME.QUEUED, 'no server is on duty to serve A');
  assert.equal(events[3].started[0].customer.id, events[2].customer.id);
  assert.equal(simulation.results.reneged, 1);
  assert.equal(simulation.results.served, 1);
});

test('a day that can never clear its line still ends', () => {
  // The only server goes home at 2.0. A customer who arrives at 3.0 with
  // unlimited patience can be neither served nor lost.
  const simulation = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    staffSchedule: [
      { time: 0, servers: 1 },
      { time: 2, servers: 0 },
    ],
    closingTime: 5,
    sampleInterarrival: scripted([3.0]),
  });
  const results = simulation.run();

  assert.equal(simulation.finished, true);
  assertClose(results.endTime, 5);
  assert.equal(results.leftInSystem, 1);
});

test('a service that never ends does not keep the day running forever', () => {
  // The scripted service times run out, so the second customer's service is
  // scheduled to end at time Infinity.
  const simulation = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    closingTime: 5,
    periodLength: 1,
    sampleInterarrival: scripted([1.0, 1.0]),
    sampleService: scripted([0.5]),
  });
  const results = simulation.run();

  assert.equal(simulation.finished, true);
  assertClose(results.endTime, 5);
  assert.equal(results.served, 1);
  assert.equal(results.leftInSystem, 1);
  assert.equal(results.periods.length, 5);
});

test('a schedule that never changes is the same as a fixed number of servers', () => {
  const shared = { arrivalRate: 20, serviceRate: 8, patienceRate: 5, closingTime: 50, seed: 12 };
  const fixed = new QueueSimulation({ ...shared, servers: 3, waitingRoom: 4 }).run();
  const scheduled = new QueueSimulation({
    ...shared,
    staffSchedule: [{ time: 0, servers: 3 }],
    waitingRoom: 4,
  }).run();

  const { rho: fixedRho, totalStaffedTime: fixedStaffed, ...fixedRest } = fixed;
  const { rho: scheduledRho, totalStaffedTime: scheduledStaffed, ...scheduledRest } = scheduled;
  assert.deepEqual(scheduledRest, fixedRest);
  // Staff time is c·T on one side and a running sum on the other.
  assertClose(scheduledStaffed, fixedStaffed, 1e-9);
  assertClose(scheduledRho, fixedRho, 1e-12);
});

test('busy servers never outnumber the servers at their post', () => {
  const simulation = new QueueSimulation({
    arrivalRate: 40,
    serviceRate: 6,
    staffSchedule: [
      { time: 0, servers: 2 },
      { time: 3, servers: 5 },
      { time: 6, servers: 1 },
      { time: 9, servers: 3 },
    ],
    waitingRoom: 8,
    patienceRate: 4,
    closingTime: 12,
    periodLength: 1,
    seed: 91,
  });
  let sawOverhang = false;
  for (let event = simulation.step(); event; event = simulation.step()) {
    // The line holds people only while every server on duty is busy.
    if (simulation.queueLength > 0) assert.ok(simulation.busyServers >= simulation.staff);
    assert.ok(simulation.queueLength <= 8);
    assert.ok(simulation.busyServers <= 5);
    if (simulation.busyServers > simulation.staff) sawOverhang = true;
  }
  const results = simulation.results;

  assert.ok(sawOverhang, 'the cut from 5 servers to 1 leaves some finishing a customer');
  assert.ok(results.rho <= 1);
  for (const period of results.periods) {
    assert.ok(!(period.rho > 1 + 1e-12), `period ${period.from}: rho ${period.rho}`);
  }
  assert.equal(results.arrivals, results.rejected + results.reneged + results.served);
});

test('an invalid staff schedule is rejected', () => {
  const base = { arrivalRate: 8, serviceRate: 10, closingTime: 10 };
  const invalid = [
    [],
    [{ time: 1, servers: 2 }], // does not start at time 0
    [
      { time: 0, servers: 2 },
      { time: 0, servers: 3 },
    ],
    [
      { time: 0, servers: 2 },
      { time: 5, servers: 1.5 },
    ],
    [
      { time: 0, servers: 2 },
      { time: 5, servers: -1 },
    ],
    [{ time: 0, servers: 0 }], // nobody ever on duty
  ];
  for (const staffSchedule of invalid) {
    assert.throws(
      () => new QueueSimulation({ ...base, staffSchedule }),
      RangeError,
      JSON.stringify(staffSchedule),
    );
  }
  // c or c(t), not both; and with c(t) the capacity is given as waiting seats.
  assert.throws(() => new QueueSimulation({ ...base, staffSchedule: SCHEDULE, servers: 2 }), RangeError);
  assert.throws(() => new QueueSimulation({ ...base, staffSchedule: SCHEDULE, capacity: 6 }), RangeError);
  assert.throws(() => new QueueSimulation({ ...base, servers: 2, capacity: 6, waitingRoom: 4 }), RangeError);
  assert.throws(() => new QueueSimulation({ ...base, waitingRoom: 2.5 }), RangeError);
  assert.throws(() => new QueueSimulation({ ...base, waitingRoom: -1 }), RangeError);
  assert.doesNotThrow(() => new QueueSimulation({ ...base, staffSchedule: SCHEDULE, waitingRoom: 4 }));
});

// ---------------------------------------------------------------------------
// Statistics per period
// ---------------------------------------------------------------------------

test('the periods of a random day add up to its totals', () => {
  const { periods, ...totals } = new QueueSimulation({
    arrivalProfile: [
      { time: 0, rate: 10 },
      { time: 5, rate: 45 },
      { time: 8, rate: 15 },
      { time: 12, rate: 25 },
    ],
    serviceRate: 12,
    staffSchedule: [
      { time: 0, servers: 2 },
      { time: 4, servers: 3 },
      { time: 9, servers: 2 },
    ],
    waitingRoom: 6,
    patienceRate: 5,
    closingTime: 12,
    periodLength: 1,
    seed: 314,
  }).run();

  assert.ok(periods.length >= 12);
  for (const key of ['arrivals', 'rejected', 'reneged', 'served']) {
    assert.equal(sum(periods, key), totals[key], key);
  }
  for (const key of ['totalQueueTime', 'totalBusyTime', 'totalStaffedTime']) {
    assertClose(sum(periods, key), totals[key], 1e-9, key);
  }
  // Periods are back to back, and the last one stops where the day ends.
  periods.forEach((period, i) => {
    assertClose(period.from, i);
    assertClose(period.to, i === periods.length - 1 ? totals.endTime : i + 1);
  });
  // Nobody arrives in a period that lies after closing.
  for (const period of periods.slice(12)) assert.equal(period.arrivals, 0);
});

test('time spent across a period boundary is split between the two periods', () => {
  // One customer in service from 0.5 to 2.75, with periods of length 1.
  const { periods } = new QueueSimulation({
    arrivalRate: 1,
    serviceRate: 1,
    closingTime: 2,
    periodLength: 1,
    sampleInterarrival: scripted([0.5]),
    sampleService: scripted([2.25]),
  }).run();

  assert.deepEqual(
    periods.map((period) => period.totalBusyTime),
    [0.5, 1, 0.75],
  );
  assert.deepEqual(
    periods.map((period) => period.served),
    [0, 0, 1],
  );
  assertClose(periods[2].to, 2.75);
});
