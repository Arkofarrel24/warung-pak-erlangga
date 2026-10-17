/**
 * "Kenapa begini?": the findings behind the day's explanation.
 *
 * Each finding is a quantity of queueing theory computed from a report, so
 * each is checked against the same quantity worked out by hand.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { explainDay } from '../src/game/explain.js';
import { defaultDecisions, newGame, playDay } from '../src/game/game.js';

function assertClose(actual, expected, tolerance = 1e-9, label = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected}, got ${actual}`);
}

const find = (findings, id) => findings.find((finding) => finding.id === id);

/** A played day: the starting setup, which is short of pegawai at lunch. */
function playedDay(overrides = {}, seed = 3) {
  const state = newGame(seed);
  return playDay(state, { ...defaultDecisions(state), ...overrides }).report;
}

test("Little's law holds exactly with the day's own numbers", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const report = playedDay({}, seed);
    const law = find(explainDay(report), 'little');

    // Lq = λ x Wq, with λ the rate of customers who got in.
    assertClose(law.rate * law.wait, law.Lq, 1e-9, `seed ${seed}`);
    assert.equal(law.entered, report.results.arrivals - report.results.rejected - report.results.soldOutAtDoor);
  }
});

test('an overloaded hour is one in which more came than c·μ can serve', () => {
  const report = playedDay();
  const finding = find(explainDay(report), 'overload');
  const { periods } = report.results;

  // Two pegawai at 12 an hour: capacity 24.
  for (const hour of finding.hours) assert.ok(periods[hour].arrivals > 24, `hour ${hour}`);
  for (let hour = 0; hour < 12; hour++) {
    if (!finding.hours.includes(hour)) assert.ok(periods[hour].arrivals <= 24, `hour ${hour}`);
  }
  const worst = periods[finding.worst.hour];
  assertClose(finding.worst.intensity, worst.arrivals / 24);
  assert.equal(finding.worst.capacity, 24);
  assert.equal(
    finding.lost,
    finding.hours.reduce((total, hour) => total + periods[hour].reneged + periods[hour].rejected, 0),
  );
  // A third pegawai raises the capacity, and fewer hours are over it.
  const staffed = find(explainDay(playedDay({ staff: 3 })), 'overload');
  assert.ok((staffed?.hours.length ?? 0) < finding.hours.length);
});

test('expected reneges are θ times the total time spent waiting', () => {
  const report = playedDay();
  const finding = find(explainDay(report), 'reneging');

  assert.equal(finding.reneged, report.results.reneged);
  assertClose(finding.expected, 5 * report.results.totalQueueTime);
  assertClose(finding.meanPatience, 1 / 5);
  // The day's count is a draw around the expectation, not far from it.
  assert.ok(Math.abs(finding.reneged - finding.expected) < 4 * Math.sqrt(finding.expected));
});

test('the Erlang-A identity holds on average over many days', () => {
  let reneged = 0;
  let expected = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const finding = find(explainDay(playedDay({}, seed)), 'reneging');
    reneged += finding?.reneged ?? 0;
    expected += finding?.expected ?? 0;
  }
  assert.ok(Math.abs(reneged / expected - 1) < 0.05, `reneged ${reneged}, expected ${expected.toFixed(1)}`);
});

test('blocking counts those who found all K places taken', () => {
  const report = playedDay();
  const finding = find(explainDay(report), 'blocking');

  assert.equal(finding.rejected, report.results.rejected);
  assert.equal(finding.places, 2 + 2);
  assertClose(finding.share, report.results.rejected / report.results.arrivals);
});

test('stock: a portion short costs its margin, a portion over costs its ingredients', () => {
  const short = find(explainDay(playedDay({ stock: 100 })), 'stock');
  assert.equal(short.kind, 'short');
  assert.equal(short.each, 4_000);
  assert.equal(short.cost, short.portions * 4_000);

  const over = find(explainDay(playedDay({ stock: 240 })), 'stock');
  assert.equal(over.kind, 'over');
  assert.equal(over.each, 6_000);
  assert.equal(over.cost, over.portions * 6_000);
});

test('the break-even point covers everything paid that day', () => {
  const report = playedDay();
  const finding = find(explainDay(report), 'breakEven');
  const { ledger } = report;

  assert.equal(finding.costs, ledger.ingredients + ledger.wages + ledger.rent);
  // Selling exactly that many portions leaves a profit of zero.
  assertClose(finding.needed * report.decisions.price - finding.costs, 0, 1e-6);
  assert.equal(finding.sold >= finding.needed, ledger.profit >= 0);
});

test('tips picked up that day lower the break-even point by what they cover', () => {
  const report = playedDay();
  const { ledger, decisions } = report;
  const plain = find(explainDay(report), 'breakEven');
  // The same day, with thirty coins picked up from the counter.
  const tips = 30_000;
  const tipped = { ...report, ledger: { ...ledger, tips, profit: ledger.profit + tips } };
  const finding = find(explainDay(tipped), 'breakEven');

  assert.equal(finding.tips, tips);
  assert.equal(finding.costs, plain.costs);
  assertClose(plain.needed - finding.needed, tips / decisions.price, 1e-9);
  // Selling exactly that many portions still leaves a profit of zero.
  assertClose(finding.needed * decisions.price + tips - finding.costs, 0, 1e-6);
  // A day saved before there were tips reads as a day without them.
  const { tips: _, ...old } = ledger;
  assertClose(find(explainDay({ ...report, ledger: old }), 'breakEven').needed, plain.needed, 1e-9);
});

test('a pegawai is idle only where one fewer would still have been enough', () => {
  const report = playedDay({ staff: 5 });
  const finding = find(explainDay(report), 'idle');
  const { serviceRate, wagePerHour } = report.setup;

  // Every hour named could have done with four: traffic intensity at most 1.
  assert.ok(finding.hours.length > 0);
  for (const hour of finding.hours) {
    assert.ok(report.results.periods[hour].arrivals <= 4 * serviceRate, `hour ${hour}`);
  }
  // What it cost is one wage for each of those hours.
  assertClose(finding.cost, finding.hours.length * wagePerHour);
  assert.equal(finding.allDay, finding.hours.length === 12);
  assert.equal(finding.scheduled, false);

  // One pegawai is the fewest there can be: nothing to spare, whatever the utilization.
  assert.equal(find(explainDay(playedDay({ staff: 1 })), 'idle'), undefined);
  // An hour that one fewer would overload is not named.
  const two = find(explainDay(playedDay({ staff: 2 })), 'idle');
  for (const hour of two?.hours ?? []) {
    assert.ok(playedDay({ staff: 2 }).results.periods[hour].arrivals <= serviceRate, `hour ${hour}`);
  }
});

test('the price is too low when the queue loses more customers than a step up would', () => {
  // Cheap and understaffed: a long queue.
  const report = playedDay({ price: 8_000, staff: 1, stock: 200 });
  const finding = find(explainDay(report), 'price');
  const { arrivals, served, reneged, rejected } = report.results;

  assert.equal(finding.kind, 'low');
  assertClose(finding.share, 1 - Math.exp(-1000 / 5000));
  assertClose(finding.keptAway, arrivals * finding.share);
  assert.equal(finding.lost, reneged + rejected);
  assert.ok(finding.lost >= finding.keptAway);
  assert.equal(finding.cost, served * 1_000);
});

test('the price is too high when nobody is lost and every hour has room', () => {
  // Dear and overstaffed: no queue at all.
  const report = playedDay({ price: 16_000, staff: 6, stock: 200 });
  const finding = find(explainDay(report), 'price');
  const { arrivals, served, reneged, rejected, soldOut } = report.results;

  assert.equal(reneged + rejected + soldOut, 0);
  assert.equal(finding.kind, 'high');
  assertClose(finding.more, arrivals * (Math.exp(1000 / 5000) - 1));
  assertClose(finding.cost, finding.more * (16_000 - 6_000 - 1_000) - served * 1_000);
  // At the dearest price there is no step up to suggest, and at the cheapest no step down.
  assert.notEqual(find(explainDay(playedDay({ price: 25_000, staff: 1, stock: 60 })), 'price')?.kind, 'low');
});

test('the costliest finding comes first', () => {
  const costs = explainDay(playedDay()).map((finding) => finding.cost);
  assert.deepEqual(costs, [...costs].sort((a, b) => b - a));
});
