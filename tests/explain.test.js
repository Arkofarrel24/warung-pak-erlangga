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

test('idle time is reported when pegawai mostly wait, with the wages it cost', () => {
  const report = playedDay({ staff: 5 });
  const finding = find(explainDay(report), 'idle');

  assertClose(finding.rho, report.results.rho);
  assertClose(finding.cost, (1 - report.results.rho) * report.ledger.wages);
  assert.equal(find(explainDay(playedDay({ staff: 1 })), 'idle'), undefined);
});

test('the costliest finding comes first', () => {
  const costs = explainDay(playedDay()).map((finding) => finding.cost);
  assert.deepEqual(costs, [...costs].sort((a, b) => b - a));
});
