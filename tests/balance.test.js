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
  eventEffects,
  fresh,
  newsvendor,
  playGames,
  POLICIES,
  PURCHASE_PRICE_SHARE,
  purchaseValues,
  rentByRule,
  rentRiseByRule,
  startDecisions,
  wageByRule,
} from '../scripts/derive.js';
import { COSTS, RENT_RISE, SEAT_COST, STARS, START, TRAINING, UPGRADES } from '../src/game/config.js';
import { rentOn } from '../src/game/day.js';
import { stars, STATUS } from '../src/game/game.js';

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

test('events: good and bad roughly cancel, and none alone can sink a warung', () => {
  const { effects, mean, ordinary } = eventEffects();

  // Averaged over the events, a day is within a few percent of an ordinary one.
  assert.ok(Math.abs(mean) < 0.05 * ordinary.contribution, `mean effect ${Math.round(mean)}`);
  // Some help and some hurt.
  assert.ok(effects.some((item) => item.effect > 50_000));
  assert.ok(effects.some((item) => item.effect < -50_000));
  // The worst single event costs well under a third of the starting cash.
  for (const item of effects) {
    assert.ok(Math.abs(item.effect) < START.cash / 4, `${item.id}: ${Math.round(item.effect)}`);
  }
});

test('the game is neither a walkover nor hopeless', () => {
  const outcome = Object.fromEntries(
    POLICIES.map(({ id, policy }) => [id, playGames(policy, 150)]),
  );
  const profit = (id) => outcome[id].meanCash - START.cash;

  // Standing still is not safe. The starting setup earns a thin profit in
  // the first week and makes a thin loss once the rent has risen, so a
  // player who never changes anything ends below the starting cash, and
  // goes under now and then, but not as a rule.
  assert.ok(profit('unchanged') < 0, `profit ${profit('unchanged')}`);
  assert.ok(profit('unchanged') > -START.cash * 0.7, `profit ${profit('unchanged')}`);
  assert.ok(outcome.unchanged.bankruptShare >= 0.05, `went bankrupt: ${outcome.unchanged.bankruptShare}`);
  assert.ok(outcome.unchanged.bankruptShare <= 0.3, `went bankrupt: ${outcome.unchanged.bankruptShare}`);

  // Reading the news and adjusting only the stock is already safer and better.
  assert.ok(outcome.newsreader.bankruptShare <= outcome.unchanged.bankruptShare);
  assert.ok(profit('newsreader') > profit('unchanged'));

  // Plain mistakes are fatal within the fourteen days.
  assert.ok(outcome.understaffed.bankruptShare >= 0.9, 'one pegawai cannot carry the lunch peak');
  assert.ok(outcome.cheap.bankruptShare >= 0.9, 'a price near cost cannot pay the rent');

  // Sound decisions are rewarded several times over, and survive every run of bad luck.
  assert.equal(outcome.careful.bankruptShare, 0);
  assert.ok(outcome.careful.meanCash > 3 * START.cash, `careful ends with ${outcome.careful.meanCash}`);
  assert.ok(outcome.careful.meanReputation > outcome.unchanged.meanReputation + 15);
});

test('the rent rise of the second week follows its rule', () => {
  const { profit, rise } = rentRiseByRule();

  assert.equal(RENT_RISE.amount, rise);
  assert.equal(RENT_RISE.fromDay, 8);
  // What the starting setup earned before the rise, it loses about half of after.
  assert.ok(profit > 0);
  assert.ok(profit - RENT_RISE.amount < 0);
  assert.ok(profit - RENT_RISE.amount > -profit);

  assert.equal(rentOn(RENT_RISE.fromDay - 1), COSTS.rent);
  assert.equal(rentOn(RENT_RISE.fromDay), COSTS.rent + RENT_RISE.amount);
  assert.equal(rentOn(14), COSTS.rent + RENT_RISE.amount);
});

test('the stars separate standing still from sound decisions', () => {
  const still = playGames(POLICIES.find((item) => item.id === 'unchanged').policy, 150);
  const careful = playGames(POLICIES.find((item) => item.id === 'careful').policy, 150);

  assert.equal(STARS.two, 2 * START.cash);
  // Standing still never earns the second star, even in its luckiest games.
  assert.ok(still.highCash < STARS.two, `the best of standing still: ${still.highCash}`);
  // A careful owner earns the third even in the unluckiest.
  assert.ok(careful.lowCash > STARS.three, `the worst of careful: ${careful.lowCash}`);

  const won = { status: STATUS.WON };
  assert.equal(stars({ ...won, cash: STARS.three }), 3);
  assert.equal(stars({ ...won, cash: STARS.three - 1 }), 2);
  assert.equal(stars({ ...won, cash: STARS.two - 1 }), 1);
  assert.equal(stars({ ...won, cash: 0 }), 1);
  assert.equal(stars({ status: STATUS.BANKRUPT, cash: -1 }), 0);
  assert.equal(stars({ status: STATUS.PLAYING, cash: 9_000_000 }), 0);
});
