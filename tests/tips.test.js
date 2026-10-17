/**
 * Tips: which customers leave a coin, how long it lies on the counter, and
 * that picking coins up changes the cash and nothing else.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { TIPS } from '../src/game/config.js';
import { defaultDecisions, newGame, playDay, startDay } from '../src/game/game.js';
import { createTipJar, servedAtOnce } from '../src/game/tips.js';
import { EVENT } from '../src/sim/engine.js';

const fresh = () => newGame(2026);

/** A customer as the engine leaves them: `waited` hours between arriving and being called. */
const customer = (id, waited = 0) => ({ id, arrivalTime: 1, serviceStart: 1 + waited });

/** Runs a day to its end, handing every departing customer to `onLeave`. */
function watch(day, onLeave) {
  while (!day.simulation.finished) {
    const record = day.simulation.step();
    if (record?.type === EVENT.DEPARTURE) onLeave(record);
  }
}

test('only a customer who did not have to wait can leave a coin', () => {
  assert.equal(servedAtOnce(customer(1)), true);
  assert.equal(servedAtOnce(customer(1, 1 / 60)), false);

  const jar = createTipJar(7, 1);
  for (let id = 1; id <= 500; id++) assert.equal(jar.leave(customer(id, 0.05), 2), null);
  assert.equal(jar.left, 0);
});

test('about one customer in five who is served at once leaves a coin', () => {
  const jar = createTipJar(7, 1);
  const customers = 20_000;
  for (let id = 1; id <= customers; id++) jar.leave(customer(id), 2);

  // Within four standard errors of the chance.
  const error = Math.sqrt((TIPS.chance * (1 - TIPS.chance)) / customers);
  assert.ok(Math.abs(jar.left / customers - TIPS.chance) < 4 * error, `left by ${jar.left} of ${customers}`);
});

test('the same customer leaves the same coin, whoever is asked about first', () => {
  const forwards = createTipJar(99, 3);
  const backwards = createTipJar(99, 3);
  const ids = Array.from({ length: 200 }, (_, i) => i + 1);
  const tippers = (jar, order) => order.filter((id) => jar.leave(customer(id), 2)).sort((a, b) => a - b);

  assert.deepEqual(tippers(forwards, ids), tippers(backwards, [...ids].reverse()));
  // Asking again does not leave a second coin.
  const before = forwards.left;
  for (const id of ids) forwards.leave(customer(id), 5);
  assert.equal(forwards.left, before);
  // Another day, or another game, is another draw.
  assert.notDeepEqual(tippers(createTipJar(99, 4), ids), tippers(createTipJar(99, 3), ids));
});

test('a coin can be picked up once, and only while it lies on the counter', () => {
  const jar = createTipJar(7, 1);
  const coins = [];
  for (let id = 1; coins.length < 3; id++) {
    const coin = jar.leave(customer(id), 2);
    if (coin) coins.push(coin);
  }
  const [first, second, third] = coins;

  assert.equal(first.amount, TIPS.amount);
  assert.equal(jar.waiting(first.id, 2), true);
  assert.equal(jar.take(first.id, 2.1), TIPS.amount);
  assert.equal(jar.take(first.id, 2.2), 0, 'already taken');

  // The last moment it is there, and the moment after.
  assert.equal(jar.take(second.id, 2 + TIPS.shelfLife), TIPS.amount);
  assert.equal(jar.waiting(third.id, 2 + TIPS.shelfLife + 0.01), false);
  assert.equal(jar.take(third.id, 2 + TIPS.shelfLife + 0.01), 0, 'gone');
  assert.equal(jar.take(12_345, 2), 0, 'never left');

  assert.equal(jar.left, 3);
  assert.equal(jar.taken, 2);
  assert.equal(jar.amount, 2 * TIPS.amount);
});

test('a day that is not watched ends with an empty jar', () => {
  const { report } = playDay(fresh(), defaultDecisions(fresh()));

  assert.equal(report.ledger.tips, 0);
  assert.deepEqual(report.tips, { left: 0, taken: 0 });
});

test('picking up coins changes the cash, and nothing about the queue', () => {
  const state = fresh();
  const decisions = defaultDecisions(state);
  const plain = playDay(state, decisions);

  const day = startDay(state, decisions);
  let offered = 0;
  watch(day, (record) => {
    const coin = day.tips.leave(record.customer, record.time);
    if (!coin) return;
    offered++;
    // Every other coin is picked up at once; the rest are left to go.
    if (offered % 2 === 1) day.tips.take(coin.id, record.time);
  });
  const tipped = day.finish();

  const taken = Math.ceil(offered / 2);
  assert.ok(offered > 5, `only ${offered} coins on a whole first day`);
  assert.deepEqual(tipped.report.tips, { left: offered, taken });
  assert.equal(tipped.report.ledger.tips, taken * TIPS.amount);
  assert.equal(tipped.report.ledger.profit, plain.report.ledger.profit + taken * TIPS.amount);
  assert.equal(tipped.state.cash, plain.state.cash + taken * TIPS.amount);

  // The day itself is the same day: who came, who was served, how long they waited.
  assert.deepEqual(tipped.report.results, plain.report.results);
  assert.equal(tipped.report.score, plain.report.score);
  assert.equal(tipped.state.reputation, plain.state.reputation);
});

test('a coin left when the day is replayed is the same coin', () => {
  const state = fresh();
  const decisions = defaultDecisions(state);
  const coinsOf = () => {
    const day = startDay(state, decisions);
    const coins = [];
    watch(day, (record) => {
      const coin = day.tips.leave(record.customer, record.time);
      if (coin) coins.push([coin.id, coin.leftAt]);
    });
    return coins;
  };

  assert.deepEqual(coinsOf(), coinsOf());
});
