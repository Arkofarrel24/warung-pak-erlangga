/**
 * The unexpected: which event a day brings, and what it changes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EVENTS } from '../src/game/config.js';
import { dayModel, settle } from '../src/game/day.js';
import { arrivalProfile } from '../src/game/demand.js';
import {
  eventArrivalProfile,
  eventBatchArrivals,
  eventForDay,
  eventStaffSchedule,
  EVENT_KIND,
  hoursOffPayroll,
  ingredientCost,
  morningNews,
} from '../src/game/events.js';
import { expectedDay } from '../src/game/forecast.js';
import { checkDecisions, defaultDecisions, newGame, playDay, PROBLEM } from '../src/game/game.js';
import { ArrivalProfile } from '../src/sim/arrival-profile.js';
import { QueueSimulation } from '../src/sim/engine.js';

function assertClose(actual, expected, tolerance = 1e-9, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, got ${actual}`,
  );
}

const IDS = Object.keys(EVENTS.catalog);
const event = (id, time) => ({ id, kind: EVENTS.catalog[id].kind, ...(time === undefined ? {} : { time }) });

/** The first game (by seed) whose given day brings the given event. */
function gameWith(id, day = 2) {
  for (let seed = 1; seed < 5000; seed++) {
    if (eventForDay(seed, day)?.id === id) return { ...newGame(seed), day };
  }
  throw new Error(`No seed found for ${id}`);
}

// ---------------------------------------------------------------------------
// Which event
// ---------------------------------------------------------------------------

test('there are ten events, five of them news and five surprises', () => {
  assert.equal(IDS.length, 10);
  const kinds = IDS.map((id) => EVENTS.catalog[id].kind);
  assert.equal(kinds.filter((kind) => kind === EVENT_KIND.NEWS).length, 5);
  assert.equal(kinds.filter((kind) => kind === EVENT_KIND.SURPRISE).length, 5);
});

test('the first day is always an ordinary one', () => {
  for (let seed = 0; seed < 500; seed++) assert.equal(eventForDay(seed, 1), null);
});

test('the event of a day follows from the seed and the day alone', () => {
  for (let seed = 0; seed < 50; seed++) {
    for (let day = 1; day <= 14; day++) {
      assert.deepEqual(eventForDay(seed, day), eventForDay(seed, day));
    }
  }
  // Different days of one game do not all bring the same thing.
  const week = Array.from({ length: 13 }, (_, i) => eventForDay(77, i + 2)?.id ?? 'none');
  assert.ok(new Set(week).size > 1, week.join(', '));
});

test('about two days in five bring an event, and every event comes up', () => {
  const counts = Object.fromEntries(IDS.map((id) => [id, 0]));
  let days = 0;
  let events = 0;
  for (let seed = 0; seed < 600; seed++) {
    for (let day = 2; day <= 14; day++) {
      days++;
      const today = eventForDay(seed, day);
      if (!today) continue;
      events++;
      counts[today.id]++;
    }
  }
  // 7,800 days: the share of event days has a standard error of about 0.0055.
  assertClose(events / days, EVENTS.chance, 0.025, 'share of days with an event');
  for (const id of IDS) {
    const share = counts[id] / events;
    assert.ok(share > 0.09 && share < 0.16, `${id}: ${(share * 100).toFixed(1)}% of events`);
  }
});

test('events that strike at a moment do so within their hours, on a quarter hour', () => {
  let seen = 0;
  for (let seed = 0; seed < 400; seed++) {
    for (let day = 2; day <= 14; day++) {
      const today = eventForDay(seed, day);
      if (!today) continue;
      const spec = EVENTS.catalog[today.id];
      if (spec.earliest === undefined) {
        assert.equal(today.time, undefined, today.id);
        continue;
      }
      seen++;
      assert.ok(today.time >= spec.earliest && today.time <= spec.latest, `${today.id} at ${today.time}`);
      assert.equal((today.time * 4) % 1, 0, `${today.id} at ${today.time}`);
    }
  }
  assert.ok(seen > 100);
});

test('the morning knows the news but not the surprises', () => {
  assert.equal(morningNews(null), null);
  for (const id of IDS) {
    const today = event(id, 5);
    assert.equal(morningNews(today), EVENTS.catalog[id].kind === EVENT_KIND.NEWS ? today : null, id);
  }
});

// ---------------------------------------------------------------------------
// What an event changes
// ---------------------------------------------------------------------------

test('only the two price events change the cost of ingredients', () => {
  assert.equal(ingredientCost(null), 6_000);
  assert.equal(ingredientCost(event('ingredientsUp')), 7_200);
  assert.equal(ingredientCost(event('ingredientsDown')), 4_800);
  for (const id of IDS.filter((other) => !other.startsWith('ingredients'))) {
    assert.equal(ingredientCost(event(id, 5)), 6_000, id);
  }
});

test('rain and payday scale the whole day of arrivals', () => {
  const base = arrivalProfile({ price: 10_000, reputation: 50 });
  const total = (points) => new ArrivalProfile(points).expectedArrivals(0, 12);

  assert.equal(eventArrivalProfile(base, null), base);
  assertClose(total(eventArrivalProfile(base, event('rain'))), 205 * 0.75);
  assertClose(total(eventArrivalProfile(base, event('payday'))), 205 * 1.25);
  // Events that are not about demand leave the profile alone.
  assert.equal(eventArrivalProfile(base, event('staffSick')), base);
  assert.equal(eventArrivalProfile(base, event('tourGroup', 5)), base);
});

test('the night market lifts arrivals from 17:00 on, with a jump at that hour', () => {
  const base = arrivalProfile({ price: 10_000, reputation: 50 });
  const profile = new ArrivalProfile(eventArrivalProfile(base, event('nightMarket')));

  assert.equal(profile.rateAt(8.5), 15, 'the afternoon is as usual');
  assert.equal(profile.rateBefore(9), 20, 'just before 17:00');
  assert.equal(profile.rateAt(9), 32, 'at 17:00: 20 x 1.6');
  assertClose(profile.rateAt(10), 28 * 1.6);
  assert.equal(profile.rateAt(12), 8 * 1.6);
  // Arrivals from 17:00 to 20:00 are 24 + 24 + 14 = 62; they become 62 x 1.6.
  assertClose(profile.expectedArrivals(0, 12), 205 + 62 * 0.6);
});

test('a sick pegawai is missing all day, but the warung never runs empty', () => {
  assert.deepEqual(eventStaffSchedule([2, 2, 2, 2], null), [{ time: 0, servers: 2 }]);
  assert.deepEqual(eventStaffSchedule([2, 2, 2, 2], event('staffSick')), [{ time: 0, servers: 1 }]);
  assert.deepEqual(eventStaffSchedule([1, 1, 1, 1], event('staffSick')), [{ time: 0, servers: 1 }], 'the owner steps in');
  assert.deepEqual(eventStaffSchedule([1, 3, 2, 3], event('staffSick')), [
    { time: 0, servers: 1 },
    { time: 3, servers: 2 },
    { time: 6, servers: 1 },
    { time: 9, servers: 2 },
  ]);
});

test('stove trouble takes one pegawai out for an hour and a half', () => {
  assert.deepEqual(eventStaffSchedule([2, 2, 2, 2], event('gasOut', 4.5)), [
    { time: 0, servers: 2 },
    { time: 4.5, servers: 1 },
    { time: 6, servers: 2 },
  ]);
  // It can straddle a change of shift.
  assert.deepEqual(eventStaffSchedule([1, 3, 2, 3], event('gasOut', 8.25)), [
    { time: 0, servers: 1 },
    { time: 3, servers: 3 },
    { time: 6, servers: 2 },
    { time: 8.25, servers: 1 },
    { time: 9, servers: 2 },
    { time: 9.75, servers: 3 },
  ]);
  assert.deepEqual(eventStaffSchedule([1, 1, 1, 1], event('gasOut', 5)), [{ time: 0, servers: 1 }]);
});

test('only the tour group brings a bulk arrival', () => {
  assert.deepEqual(eventBatchArrivals(null), []);
  assert.deepEqual(eventBatchArrivals(event('tourGroup', 6.25)), [{ time: 6.25, size: 14 }]);
  assert.deepEqual(eventBatchArrivals(event('rain')), []);
});

test('the event reaches the queueing model', () => {
  const state = newGame(1);
  const decisions = defaultDecisions(state);

  const ordinary = dayModel(state, decisions);
  assert.equal(ordinary.servers, 2);
  assert.equal(ordinary.batchArrivals, undefined);

  assert.equal(dayModel(state, decisions, event('staffSick')).servers, 1);
  assert.deepEqual(dayModel(state, decisions, event('tourGroup', 3)).batchArrivals, [{ time: 3, size: 14 }]);
  assert.deepEqual(dayModel(state, decisions, event('gasOut', 2)).staffSchedule, [
    { time: 0, servers: 2 },
    { time: 2, servers: 1 },
    { time: 3.5, servers: 2 },
  ]);
  assert.equal(dayModel(state, decisions, event('rain')).arrivalProfile[4].rate, 32 * 0.75);
});

test('dearer ingredients show up in the accounts', () => {
  const state = newGame(1);
  const decisions = { ...defaultDecisions(state), stock: 100 };
  const results = { served: 90, stockLeft: 10, totalStaffedTime: 24 };

  const ordinary = settle(state, state, decisions, results);
  const dear = settle(state, state, decisions, results, event('ingredientsUp'));
  assert.equal(ordinary.ingredients, 600_000);
  assert.equal(dear.ingredients, 720_000);
  assert.equal(dear.waste, 72_000);
  assert.equal(dear.profit, ordinary.profit - 120_000);
});

test('going viral raises arrivals from the moment it happens, not before', () => {
  const base = arrivalProfile({ price: 10_000, reputation: 50 });
  const factor = EVENTS.catalog.viral.demandFactor;
  const before = new ArrivalProfile(base);

  // On the hour: the point of the profile itself becomes the jump.
  const onTheHour = new ArrivalProfile(eventArrivalProfile(base, event('viral', 5)));
  assertClose(onTheHour.expectedArrivals(0, 5), before.expectedArrivals(0, 5));
  assertClose(onTheHour.expectedArrivals(5, 12), before.expectedArrivals(5, 12) * factor);

  // Between two hours: the jump is put where it happens.
  const between = new ArrivalProfile(eventArrivalProfile(base, event('viral', 6.25)));
  assertClose(between.expectedArrivals(0, 6.25), before.expectedArrivals(0, 6.25));
  assertClose(between.expectedArrivals(6.25, 12), before.expectedArrivals(6.25, 12) * factor);
  assertClose(between.rateBefore(6.25), before.rateAt(6.25));
  assertClose(between.rateAt(6.25), before.rateAt(6.25) * factor);
});

test('a helper adds one pegawai for a few hours', () => {
  assert.deepEqual(eventStaffSchedule([2, 2, 2, 2], event('helper', 4.5)), [
    { time: 0, servers: 2 },
    { time: 4.5, servers: 3 },
    { time: 7.5, servers: 2 },
  ]);
  // Across a change of shift the helper is added to whoever is on duty.
  assert.deepEqual(eventStaffSchedule([1, 3, 2, 3], event('helper', 5)), [
    { time: 0, servers: 1 },
    { time: 3, servers: 3 },
    { time: 5, servers: 4 },
    { time: 6, servers: 3 },
    { time: 8, servers: 2 },
    { time: 9, servers: 3 },
  ]);
});

test('wages follow the story of the event, not only the hours at the counter', () => {
  const state = newGame(1);
  const decisions = { ...defaultDecisions(state), stock: 100 };
  const wagesFor = (today, staffedTime) =>
    settle(state, state, decisions, { served: 90, stockLeft: 10, totalStaffedTime: staffedTime }, today).wages;

  // An ordinary day: two pegawai for twelve hours.
  assert.equal(hoursOffPayroll([2, 2, 2, 2], null), 0);
  assert.equal(wagesFor(null, 24), 8_500 * 24);

  // The nephew serves for three hours and is not paid.
  assert.equal(hoursOffPayroll([2, 2, 2, 2], event('helper', 4)), 3);
  assert.equal(wagesFor(event('helper', 4), 27), 8_500 * 24);

  // The pegawai who goes for gas is away for an hour and a half, and paid all the same.
  assert.equal(hoursOffPayroll([2, 2, 2, 2], event('gasOut', 4)), -1.5);
  assert.equal(wagesFor(event('gasOut', 4), 22.5), 8_500 * 24);
  // With one pegawai the owner goes instead, and nothing changes at the counter.
  assert.equal(hoursOffPayroll([1, 1, 1, 1], event('gasOut', 4)), 0);

  // A pegawai who is sick is not at the counter and not paid.
  assert.equal(hoursOffPayroll([2, 2, 2, 2], event('staffSick')), 0);
  assert.equal(wagesFor(event('staffSick'), 12), 8_500 * 12);
});

// ---------------------------------------------------------------------------
// In a game
// ---------------------------------------------------------------------------

test('a day in a game carries its event into the report', () => {
  for (const id of IDS) {
    const state = gameWith(id);
    const decisions = { ...defaultDecisions(state), stock: 100 };
    const { report } = playDay(state, decisions);

    assert.equal(report.event.id, id);
    assert.equal(report.event.kind, EVENTS.catalog[id].kind);
    assert.equal(report.setup.ingredientCost, ingredientCost(report.event), id);
    assert.equal(report.ledger.ingredients, ingredientCost(report.event) * 100, id);
    assert.deepEqual(JSON.parse(JSON.stringify(report.event)), report.event, 'survives saving');
  }
  const calm = playDay(newGame(1), defaultDecisions(newGame(1))).report;
  assert.equal(calm.event, null);
  assert.equal(calm.setup.ingredientCost, 6_000);
});

test('on a day of dear ingredients the cash buys fewer portions', () => {
  const state = gameWith('ingredientsUp');
  const codes = (stock) => checkDecisions(state, { ...defaultDecisions(state), stock }).map((problem) => problem.code);

  // Rp 1,500,000 at Rp 7,200 a portion: 208 portions.
  assert.deepEqual(codes(208), []);
  assert.deepEqual(codes(209), [PROBLEM.CASH]);
});

test('a surprise cannot be seen coming in the morning', () => {
  const state = gameWith('staffSick');
  // The rules for the morning are those of an ordinary day.
  const codes = (stock) => checkDecisions(state, { ...defaultDecisions(state), stock }).map((problem) => problem.code);
  assert.deepEqual(codes(250), []);
  assert.deepEqual(codes(251), [PROBLEM.CASH]);

  const { report } = playDay(state, defaultDecisions(state));
  // Two were hired; one served.
  assert.deepEqual(report.decisions.staff, 2);
  assertClose(report.results.totalStaffedTime / report.results.endTime, 1, 1e-9, 'pegawai on duty');
  assert.equal(report.ledger.wages, Math.round(8_500 * report.results.totalStaffedTime), 'the sick pegawai is not paid');
});

test('a tour group arrives in the hour the event says', () => {
  const state = gameWith('tourGroup');
  const today = eventForDay(state.seed, state.day);
  const withGroup = playDay(state, defaultDecisions(state)).report.results;

  // The same day without the group: the same regular customers, 14 fewer in all.
  const model = dayModel(state, defaultDecisions(state));
  const without = new QueueSimulation({
    ...model,
    stock: defaultDecisions(state).stock,
    seed: state.seed,
    replication: state.day,
  }).run();
  assert.equal(withGroup.arrivals, without.arrivals + 14);
  const hour = Math.floor(today.time);
  assert.equal(withGroup.periods[hour].arrivals, without.periods[hour].arrivals + 14);
});

// ---------------------------------------------------------------------------
// Against theory
// ---------------------------------------------------------------------------

/**
 * Each kind of event, simulated thousands of times and compared with the
 * forecast for the same event: the check that an event changes the simulated
 * day and the computed day in the same way.
 */
for (const today of [
  event('nightMarket'),
  event('staffSick'),
  event('tourGroup', 4.25),
  event('gasOut', 3.5),
  event('viral', 5.25),
  event('helper', 4.5),
]) {
  test(`simulated days match the forecast: ${today.id}`, () => {
    const DAYS = 5000;
    const state = { ...newGame(1), reputation: 60 };
    const decisions = { ...defaultDecisions(state), staff: 3, price: 11_000, seats: 2 };
    const forecast = expectedDay(state, decisions, today);

    const keys = ['arrivals', 'served', 'reneged', 'rejected', 'totalQueueTime', 'totalStaffedTime'];
    const sums = Object.fromEntries(keys.map((key) => [key, 0]));
    const squares = Object.fromEntries(keys.map((key) => [key, 0]));
    for (let replication = 0; replication < DAYS; replication++) {
      const results = new QueueSimulation({ ...forecast.model, seed: 606, replication }).run();
      for (const key of keys) {
        sums[key] += results[key];
        squares[key] += results[key] ** 2;
      }
    }
    for (const key of keys) {
      const mean = sums[key] / DAYS;
      const variance = Math.max((squares[key] - DAYS * mean * mean) / (DAYS - 1), 0);
      const expected = forecast.theory[key];
      const apart = Math.abs(mean - expected) < 1e-9 ? 0 : Math.abs(mean - expected) / Math.sqrt(variance / DAYS);
      assert.ok(apart < 4, `${key}: forecast ${expected}, simulation ${mean} (${apart.toFixed(1)} standard errors)`);
    }
  });
}
