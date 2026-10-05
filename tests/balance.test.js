/**
 * The balance of the game, held to its rules.
 *
 * Every balance number in src/game/config.js is supposed to follow from the
 * model by a rule (scripts/derive.js). These tests recompute each rule and
 * fail when a number has drifted away from it, for instance after someone
 * changes the arrival profile or the service rate without redoing the rest.
 * `npm run balance` prints the same working in full.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cashByRule,
  demandSample,
  fresh,
  newsvendor,
  playGames,
  POLICIES,
  PURCHASE_PRICE_SHARE,
  purchaseValues,
  rentByRule,
  startDecisions,
  wageByRule,
} from '../scripts/derive.js';
import { COSTS, SEAT_COST, START, TRAINING, UPGRADES } from '../src/game/config.js';

/** The game uses round numbers, so a number may sit this far from its rule. */
const ROUNDING = 0.05;

function assertFollowsRule(label, actual, byRule) {
  const off = Math.abs(actual - byRule) / byRule;
  assert.ok(
    off <= ROUNDING,
    `${label}: the game uses ${actual}, the rule gives ${Math.round(byRule)} (${(off * 100).toFixed(1)}% apart)`,
  );
}

const demands = demandSample(fresh(), startDecisions());
const values = purchaseValues();

test('wage: a third pegawai just pays for itself on the day', () => {
  assertFollowsRule('wage per hour', COSTS.wagePerHour, wageByRule().perHour);
});

test('first stock: the newsvendor quantile of demand', () => {
  const { stock, criticalRatio } = newsvendor(demands, START.price);

  // Margin Rp 4,000 against cost Rp 6,000.
  assert.equal(criticalRatio, 0.4);
  assert.ok(Math.abs(START.stock - stock) <= 3, `the game starts with ${START.stock}, the rule gives ${stock}`);
});

test('rent: the starting setup keeps about 5% of its sales income', () => {
  assertFollowsRule('rent', COSTS.rent, rentByRule(demands).rent);
});

test('starting cash: one full day of costs with no income', () => {
  assertFollowsRule('starting cash', START.cash, cashByRule().cash);
});

test('purchases: each costs half of what it brings over the game', () => {
  const price = (value) => value * PURCHASE_PRICE_SHARE;

  assertFollowsRule('cash register', UPGRADES.cashRegister.cost, price(values.cashRegister));
  assertFollowsRule('queue numbers', UPGRADES.queueNumbers.cost, price(values.queueNumbers));
  assertFollowsRule('shift board', UPGRADES.shiftBoard.cost, price(values.shiftBoard));
  values.training.forEach((value, i) => {
    assertFollowsRule(`training level ${i + 1}`, TRAINING[i + 1].cost, price(value));
  });
  assertFollowsRule('a waiting seat', SEAT_COST, price(values.seats[0]));
});

test('seats and training show diminishing returns', () => {
  const [third, fourth, fifth, sixth] = values.seats;

  assert.ok(third > 2 * fourth, 'the fourth seat brings much less than the third');
  assert.ok(fourth > 0);
  // A seat far back in the line is more often given up on than served from.
  assert.ok(fifth < SEAT_COST / 10 && sixth < SEAT_COST / 10, 'from the fifth on a seat brings nothing');

  const [first, second, last] = values.training;
  assert.ok(first > second && second > last && last > 0);
});

test('the game is neither a walkover nor hopeless', () => {
  const outcome = Object.fromEntries(
    POLICIES.map(({ id, policy }) => [id, playGames(policy, 100)]),
  );
  const profit = (id) => outcome[id].meanCash - START.cash;

  // Doing nothing gets you nowhere: no bankruptcy, and no fortune either.
  assert.ok(outcome.unchanged.bankruptShare <= 0.02, 'the starting setup does not sink the warung');
  assert.ok(profit('unchanged') > 0 && profit('unchanged') < 1_000_000, `profit ${profit('unchanged')}`);

  // Plain mistakes are fatal within the fourteen days.
  assert.ok(outcome.understaffed.bankruptShare >= 0.9, 'one pegawai cannot carry the lunch peak');
  assert.ok(outcome.cheap.bankruptShare >= 0.9, 'a price near cost cannot pay the rent');

  // Sound decisions are rewarded several times over.
  assert.equal(outcome.careful.bankruptShare, 0);
  assert.ok(profit('careful') > 4 * profit('unchanged'), `careful ${profit('careful')}, unchanged ${profit('unchanged')}`);
  assert.ok(outcome.careful.meanReputation > outcome.unchanged.meanReputation + 15);
});
