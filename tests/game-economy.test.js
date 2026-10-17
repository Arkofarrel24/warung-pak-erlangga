/**
 * The pieces of the game's economy, each checked against a hand calculation:
 * demand, reputation, the queueing model a set of decisions turns into, and
 * the day's accounts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { COSTS, DEMAND, GROWTH, REPUTATION, SEAT_COST, TRAINING, UPGRADES } from '../src/game/config.js';
import {
  applyPurchases,
  dayModel,
  patienceRate,
  purchaseCost,
  serviceRate,
  settle,
  staffPerShift,
  wagePerHour,
} from '../src/game/day.js';
import { arrivalProfile, growthFactor, priceFactor, reputationFactor } from '../src/game/demand.js';
import { defaultDecisions, newGame } from '../src/game/game.js';
import { dayScore, nextReputation } from '../src/game/reputation.js';
import { ArrivalProfile } from '../src/sim/arrival-profile.js';

function assertClose(actual, expected, tolerance = 1e-9, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, got ${actual}`,
  );
}

const fresh = () => newGame(7);
const withUpgrades = (state, ...ids) => ({
  ...state,
  upgrades: { ...state.upgrades, ...Object.fromEntries(ids.map((id) => [id, true])) },
});

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

test('the price factor is 1 at the reference price and falls by e per Rp 5,000', () => {
  assert.equal(priceFactor(10_000), 1);
  assertClose(priceFactor(15_000), Math.exp(-1));
  assertClose(priceFactor(5_000), Math.exp(1));
  // Each Rp 1,000 turns away about 18% of customers.
  assertClose(1 - priceFactor(11_000), 0.181, 0.001);
});

test('with unlimited capacity the best price is ingredient cost plus price sensitivity', () => {
  // Margin x demand, (p - v)·e^(-(p - p0)/s), peaks at p = v + s.
  const income = (price) => (price - COSTS.ingredient) * priceFactor(price);
  const best = COSTS.ingredient + DEMAND.priceSensitivity;

  assert.equal(best, 11_000);
  for (const price of [8_000, 10_000, 10_500, 11_500, 13_000, 16_000, 20_000]) {
    assert.ok(income(best) > income(price), `Rp ${price} should bring less than Rp ${best}`);
  }
});

test('the reputation factor runs from 0.4 through 1 to 1.6', () => {
  assertClose(reputationFactor(0), 0.4);
  assertClose(reputationFactor(50), 1);
  assertClose(reputationFactor(100), 1.6);
});

test('at the reference price and a reputation of 50 the arrival profile is the base profile', () => {
  const profile = arrivalProfile({ price: 10_000, reputation: 50 });

  assert.equal(profile.length, 13, 'one point per full hour, 08:00 to 20:00');
  assert.deepEqual(
    profile.map((point) => point.time),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  profile.forEach((point, hour) => assertClose(point.rate, DEMAND.baseProfile[hour], 1e-12));
  // Trapezoids: 7 + 9 + 14 + 25 + 31 + 22 + 11 + 9 + 15 + 24 + 24 + 14
  assertClose(new ArrivalProfile(profile).expectedArrivals(0, 12), 205);
});

test('price and reputation scale the whole profile together', () => {
  const profile = arrivalProfile({ price: 15_000, reputation: 100 });
  const factor = Math.exp(-1) * 1.6;

  profile.forEach((point, hour) => assertClose(point.rate, DEMAND.baseProfile[hour] * factor, 1e-12));
});

test('from the second week the same price and reputation bring more customers', () => {
  const first = arrivalProfile({ price: 12_000, reputation: 70, day: GROWTH.fromDay - 1 });
  const second = arrivalProfile({ price: 12_000, reputation: 70, day: GROWTH.fromDay });

  assert.equal(growthFactor(1), 1);
  assert.equal(growthFactor(GROWTH.fromDay - 1), 1);
  assert.equal(growthFactor(GROWTH.fromDay), GROWTH.demandFactor);
  assert.equal(growthFactor(14), GROWTH.demandFactor);
  // Every hour by the same factor: the shape of the day does not change.
  second.forEach((point, hour) => assertClose(point.rate, first[hour].rate * GROWTH.demandFactor, 1e-12));
  // Without a day, a day of the first week.
  assert.deepEqual(arrivalProfile({ price: 12_000, reputation: 70 }), first);
});

// ---------------------------------------------------------------------------
// Reputation
// ---------------------------------------------------------------------------

test('the day score matches the hand calculation', () => {
  // 200 customers came. 170 were served, 12 gave up, 10 found the place full,
  // 8 found it sold out. Together they waited 5 customer-hours.
  //   served                  +170
  //   waiting, 5 h / 20 min    -15
  //   gave up, 12 x 1          -12
  //   turned away, 18 x 0.5     -9
  //                           ----
  //                            134 points for 200 customers = 67
  const score = dayScore({
    arrivals: 200,
    served: 170,
    reneged: 12,
    rejected: 10,
    soldOut: 8,
    totalQueueTime: 5,
  });
  assertClose(score, 67);
});

test('the day score stays between 0 and 100', () => {
  const day = { arrivals: 100, served: 0, reneged: 0, rejected: 0, soldOut: 0, totalQueueTime: 0 };

  assert.equal(dayScore({ ...day, served: 100 }), 100, 'everyone served without waiting');
  assert.equal(dayScore({ ...day, reneged: 100, totalQueueTime: 20 }), 0, 'everyone gave up');
  assert.equal(dayScore({ ...day, rejected: 100 }), 0, 'everyone turned away');
});

test('twenty minutes of waiting cancel one satisfied customer', () => {
  const day = { arrivals: 10, served: 10, reneged: 0, rejected: 0, soldOut: 0 };
  assertClose(dayScore({ ...day, totalQueueTime: 20 / 60 }), 90);
});

test('a day without customers has no score and leaves the reputation alone', () => {
  const score = dayScore({ arrivals: 0, served: 0, reneged: 0, rejected: 0, soldOut: 0, totalQueueTime: 0 });

  assert.equal(score, null);
  assert.equal(nextReputation(63, score), 63);
});

test('the reputation moves 30% of the way toward the day score', () => {
  assert.equal(REPUTATION.memory, 0.3);
  assertClose(nextReputation(50, 80), 59);
  assertClose(nextReputation(50, 20), 41);
  assertClose(nextReputation(70, 70), 70);
  // Repeating the same score closes the gap geometrically: 0.7^n of it is left.
  let reputation = 50;
  for (let day = 0; day < 5; day++) reputation = nextReputation(reputation, 90);
  assertClose(reputation, 90 - 40 * 0.7 ** 5);
});

// ---------------------------------------------------------------------------
// From decisions to queueing parameters
// ---------------------------------------------------------------------------

test('training and the cash register multiply the service rate', () => {
  const state = fresh();

  assert.equal(serviceRate(state), 12);
  assertClose(serviceRate({ ...state, trainingLevel: 2 }), 12 * 1.3);
  assertClose(serviceRate(withUpgrades(state, 'cashRegister')), 12 * 1.2);
  assertClose(serviceRate(withUpgrades({ ...state, trainingLevel: 2 }, 'cashRegister')), 12 * 1.3 * 1.2);
});

test('queue numbers make customers more patient', () => {
  const state = fresh();

  assert.equal(patienceRate(state), 5, 'mean patience 12 minutes');
  assertClose(patienceRate(withUpgrades(state, 'queueNumbers')), 5 / 1.5);
  assertClose(60 / patienceRate(withUpgrades(state, 'queueNumbers')), 18, 1e-9, 'mean patience in minutes');
});

test('trained pegawai are paid more', () => {
  assert.equal(wagePerHour(fresh()), 8_500);
  assertClose(wagePerHour({ ...fresh(), trainingLevel: 1 }), 8_500 * 1.08);
  assertClose(wagePerHour({ ...fresh(), trainingLevel: 3 }), 8_500 * 1.24);
});

test('purchases add up, and buying leaves the earlier state untouched', () => {
  const state = fresh();
  const buy = { seats: 2, training: true, upgrades: ['cashRegister', 'shiftBoard'] };
  const expected =
    2 * SEAT_COST + TRAINING[1].cost + UPGRADES.cashRegister.cost + UPGRADES.shiftBoard.cost;

  assert.equal(expected, 160_000 + 375_000 + 650_000 + 525_000);
  assert.equal(purchaseCost(state, buy), expected);
  assert.equal(purchaseCost(state, {}), 0);
  assert.equal(purchaseCost(state), 0);

  const equipped = applyPurchases(state, buy);
  assert.equal(equipped.cash, state.cash - expected);
  assert.equal(equipped.seatsOwned, 4);
  assert.equal(equipped.trainingLevel, 1);
  assert.deepEqual(equipped.upgrades, { cashRegister: true, queueNumbers: false, shiftBoard: true });
  assert.deepEqual(state, fresh(), 'the state passed in is not changed');
});

test('each training level has its own price', () => {
  assert.equal(purchaseCost({ ...fresh(), trainingLevel: 0 }, { training: true }), 375_000);
  assert.equal(purchaseCost({ ...fresh(), trainingLevel: 1 }, { training: true }), 325_000);
  assert.equal(purchaseCost({ ...fresh(), trainingLevel: 2 }, { training: true }), 300_000);
});

test('the starting decisions become an M(t)/M/2/4+M queue', () => {
  const state = fresh();
  const model = dayModel(state, defaultDecisions(state));

  assert.equal(model.servers, 2);
  assert.equal(model.staffSchedule, undefined);
  assert.equal(model.waitingRoom, 2, 'K = c + seats = 4');
  assert.equal(model.serviceRate, 12);
  assert.equal(model.patienceRate, 5);
  assert.equal(model.closingTime, 12);
  assert.equal(model.periodLength, 1);
  assert.equal(model.arrivalProfile.length, 13);
});

test('without a shift board the same number of pegawai works every shift', () => {
  const state = fresh();
  const decisions = { ...defaultDecisions(state), staff: 3, shifts: [1, 4, 2, 4] };

  assert.deepEqual(staffPerShift(state, decisions), [3, 3, 3, 3]);
  assert.equal(dayModel(state, decisions).servers, 3);
});

test('with a shift board the shifts become a staff schedule c(t)', () => {
  const state = withUpgrades(fresh(), 'shiftBoard');
  const base = defaultDecisions(state);

  assert.deepEqual(dayModel(state, { ...base, shifts: [1, 3, 2, 3] }).staffSchedule, [
    { time: 0, servers: 1 },
    { time: 3, servers: 3 },
    { time: 6, servers: 2 },
    { time: 9, servers: 3 },
  ]);
  // Two shifts in a row with the same number make one entry.
  assert.deepEqual(dayModel(state, { ...base, shifts: [2, 2, 3, 3] }).staffSchedule, [
    { time: 0, servers: 2 },
    { time: 6, servers: 3 },
  ]);
  // The same number all day is not a schedule at all.
  const flat = dayModel(state, { ...base, shifts: [3, 3, 3, 3] });
  assert.equal(flat.servers, 3);
  assert.equal(flat.staffSchedule, undefined);
  // No shifts given: the daily number applies.
  assert.equal(dayModel(state, { ...base, staff: 4, shifts: null }).servers, 4);
});

test('the number of seats put out is the waiting room', () => {
  const state = { ...fresh(), seatsOwned: 6 };
  assert.equal(dayModel(state, { ...defaultDecisions(state), seats: 5 }).waitingRoom, 5);
  assert.equal(dayModel(state, { ...defaultDecisions(state), seats: 0 }).waitingRoom, 0);
});

// ---------------------------------------------------------------------------
// The day's accounts
// ---------------------------------------------------------------------------

test('the accounts match the hand calculation', () => {
  // Rp 12,000 a portion, 150 portions prepared, one seat bought in the morning.
  // 140 customers were served; the pegawai were at their post 24.5 hours in all.
  //   revenue       140 x 12,000          1,680,000
  //   ingredients   150 x 6,000            -900,000
  //   wages         24.5 x 8,500           -208,250
  //   rent                                 -375,000
  //   profit                                196,750
  //   cash          1,500,000 - 80,000 (seat) + 196,750 = 1,616,750
  const before = fresh();
  const decisions = { ...defaultDecisions(before), price: 12_000, stock: 150, seats: 3, buy: { seats: 1 } };
  const equipped = applyPurchases(before, decisions.buy);
  const ledger = settle(before, equipped, decisions, {
    served: 140,
    stockLeft: 10,
    totalStaffedTime: 24.5,
  });

  assert.deepEqual(ledger, {
    revenue: 1_680_000,
    tips: 0,
    ingredients: 900_000,
    waste: 60_000,
    wages: 208_250,
    paidHours: 24.5,
    rent: 375_000,
    profit: 196_750,
    purchases: 80_000,
    cashBefore: 1_500_000,
    cashAfter: 1_616_750,
  });
});

test('tips are income of the day, on top of the sales', () => {
  // The same day as above, with 17 coins of Rp 1,000 picked up from the counter:
  //   profit   196,750 + 17,000 = 213,750
  //   cash     1,616,750 + 17,000 = 1,633,750
  const before = fresh();
  const decisions = { ...defaultDecisions(before), price: 12_000, stock: 150, seats: 3, buy: { seats: 1 } };
  const equipped = applyPurchases(before, decisions.buy);
  const results = { served: 140, stockLeft: 10, totalStaffedTime: 24.5 };
  const without = settle(before, equipped, decisions, results);
  const withTips = settle(before, equipped, decisions, results, null, 17_000);

  assert.equal(withTips.tips, 17_000);
  assert.equal(withTips.profit, 213_750);
  assert.equal(withTips.cashAfter, 1_633_750);
  // Nothing else on the receipt moves.
  assert.deepEqual({ ...withTips, tips: 0, profit: without.profit, cashAfter: without.cashAfter }, without);
});

test('ingredients are paid for the portions prepared, not the portions sold', () => {
  const before = fresh();
  const decisions = { ...defaultDecisions(before), stock: 200 };
  const sold = (served) =>
    settle(before, before, decisions, { served, stockLeft: 200 - served, totalStaffedTime: 24 });

  assert.equal(sold(200).ingredients, sold(120).ingredients);
  assert.equal(sold(120).waste, 80 * 6_000);
  assert.equal(sold(200).profit - sold(120).profit, 80 * 10_000, 'each unsold portion loses its full price');
});

test('wages follow the wage of trained pegawai', () => {
  const before = { ...fresh(), trainingLevel: 2 };
  const ledger = settle(before, before, defaultDecisions(before), {
    served: 0,
    stockLeft: 160,
    totalStaffedTime: 30,
  });
  assert.equal(ledger.wages, Math.round(30 * 8_500 * 1.16));
});
