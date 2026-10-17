/**
 * The day's challenge and the guest book: both only read what the day
 * already produced, and a met challenge adds its small reward to the cash.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CHALLENGE_IDS, challengeForDay, challengeMet, lostCustomers, stockMiss } from '../src/game/challenges.js';
import { CHALLENGES } from '../src/game/config.js';
import { defaultDecisions, newGame, playDay, startDay } from '../src/game/game.js';
import { REVIEW } from '../src/game/reviews.js';
import { QueueSimulation } from '../src/sim/engine.js';

const fresh = () => newGame(2026);
const results = (overrides) => ({ arrivals: 100, served: 95, reneged: 2, rejected: 2, soldOut: 1, stockLeft: 4, ...overrides });

test('a day has one challenge, fixed by the seed and the day', () => {
  const days = Array.from({ length: 14 }, (_, i) => challengeForDay(2026, i + 1));

  assert.deepEqual(days, Array.from({ length: 14 }, (_, i) => challengeForDay(2026, i + 1)));
  for (const id of days) assert.ok(CHALLENGE_IDS.includes(id), id);
  // Over many days every challenge comes up.
  const seen = new Set(Array.from({ length: 200 }, (_, i) => challengeForDay(7, i + 1)));
  assert.equal(seen.size, CHALLENGE_IDS.length);
});

test('each challenge is met at its threshold and missed just past it', () => {
  assert.equal(challengeMet('served', results({ served: 90 })), true);
  assert.equal(challengeMet('served', results({ served: 89 })), false);
  assert.equal(challengeMet('served', results({ arrivals: 0, served: 0 })), false, 'a day without customers meets nothing');

  assert.equal(challengeMet('patient', results({ reneged: CHALLENGES.reneged })), true);
  assert.equal(challengeMet('patient', results({ reneged: CHALLENGES.reneged + 1 })), false);

  assert.equal(lostCustomers(results({ reneged: 5, rejected: 7, soldOut: 5 })), 17);
  assert.equal(challengeMet('kept', results({ reneged: 5, rejected: 7, soldOut: 5 })), true);
  assert.equal(challengeMet('kept', results({ reneged: 5, rejected: 7, soldOut: 6 })), false);

  assert.equal(stockMiss(results({ stockLeft: 6, soldOut: 4 })), 10);
  assert.equal(challengeMet('stock', results({ stockLeft: 6, soldOut: 4 })), true);
  assert.equal(challengeMet('stock', results({ stockLeft: 11, soldOut: 0 })), false);

  assert.equal(challengeMet('no such challenge', results()), false);
});

test('a met challenge adds its reward to the cash, and to nothing else', () => {
  // Some day of some game meets its challenge, and some day does not.
  const seen = { met: null, missed: null };
  for (let seed = 1; seed < 60 && !(seen.met && seen.missed); seed++) {
    const state = newGame(seed);
    const out = playDay(state, { ...defaultDecisions(state), staff: 3 });
    seen[out.report.challenge.met ? 'met' : 'missed'] ??= { before: state, report: out.report };
  }
  assert.ok(seen.met && seen.missed);

  for (const { before: state, report } of [seen.met, seen.missed]) {
    const { ledger, challenge } = report;
    assert.equal(challenge.id, challengeForDay(state.seed, state.day));
    assert.equal(challenge.met, challengeMet(challenge.id, report.results));
    assert.equal(ledger.stamp, challenge.met ? CHALLENGES.reward : 0);
    // Not part of the profit: the warung did not sell it.
    assert.equal(ledger.profit, ledger.revenue + ledger.tips - ledger.ingredients - ledger.wages - ledger.rent);
    assert.equal(ledger.cashAfter, ledger.cashBefore - ledger.purchases + ledger.profit + ledger.stamp);
  }
});

test('the guest book changes nothing about the day', () => {
  const state = fresh();
  const decisions = defaultDecisions(state);
  const { report } = playDay(state, decisions);
  // The same day, straight from the engine, with nobody reading along.
  const day = startDay(state, decisions);
  const plain = new QueueSimulation({ ...day.model, stock: decisions.stock, seed: state.seed, replication: state.day }).run();

  assert.equal(report.results.arrivals, plain.arrivals);
  assert.equal(report.results.served, plain.served);
  assert.equal(report.results.reneged, plain.reneged);
  assert.equal(report.results.totalQueueTime, plain.totalQueueTime);
});

test('every review is a customer the engine simulated, with what happened to them', () => {
  const state = fresh();
  const day = startDay(state, defaultDecisions(state));
  const seen = new Map();
  while (!day.simulation.finished) {
    const record = day.simulation.step();
    if (record?.customer) seen.set(record.customer.id, record.customer);
  }
  const { report } = day.finish();

  assert.ok(report.reviews.length > 0 && report.reviews.length <= 3);
  const kinds = new Set(Object.values(REVIEW));
  for (const review of report.reviews) {
    assert.ok(kinds.has(review.kind), review.kind);
    const customer = seen.get(review.customer);
    assert.ok(customer, `customer ${review.customer} was in the day`);
    assert.equal(review.arrivedAt, customer.arrivalTime);
    if (review.kind === REVIEW.RENEGED) assert.equal(review.wait, customer.renegedAt - customer.arrivalTime);
    if (review.kind === REVIEW.SERVED_AFTER_WAIT) assert.equal(review.wait, customer.serviceStart - customer.arrivalTime);
    if (review.kind === REVIEW.SERVED_AT_ONCE) assert.equal(customer.serviceStart, customer.arrivalTime);
  }
  // On a day with customers who gave up, the one who waited longest before leaving is among them.
  if (report.results.reneged > 0) {
    const longest = Math.max(...[...seen.values()].filter((c) => c.renegedAt !== null).map((c) => c.renegedAt - c.arrivalTime));
    assert.equal(report.reviews.find((review) => review.kind === REVIEW.RENEGED).wait, longest);
  }
  // It survives being saved.
  assert.deepEqual(JSON.parse(JSON.stringify(report.reviews)), report.reviews);
});
