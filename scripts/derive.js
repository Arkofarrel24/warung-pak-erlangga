/**
 * The rules behind the game's balance numbers, as functions.
 *
 * scripts/balance.js prints their results with the working shown, and
 * tests/balance.test.js checks that the numbers in src/game/config.js still
 * follow them. Nothing here is used while the game is being played.
 *
 * The rules, in the order they depend on one another:
 *
 *   wage           a third pegawai should just pay for itself on the day
 *   first stock    the newsvendor quantile of the first day's demand
 *   rent           the starting setup should earn about 5% of what its sales
 *                  bring in: doing nothing gets you nowhere
 *   starting cash  one full day of costs with no income at all
 *   purchases      half of what each brings over 14 days when bought on day 1
 */

import { COSTS, DAY, START } from '../src/game/config.js';
import { expectedDay } from '../src/game/forecast.js';
import { defaultDecisions, newGame, playDay, STATUS } from '../src/game/game.js';
import { nextReputation } from '../src/game/reputation.js';
import { QueueSimulation } from '../src/sim/engine.js';

/** The share of the starting setup's sales income that should be left as profit. */
export const STARTING_PROFIT_SHARE = 0.05;
/** A purchase costs this share of what it earns over the game when bought on day 1. */
export const PURCHASE_PRICE_SHARE = 0.5;

/** The warung as the player receives it, and the decisions it opens with. */
export const fresh = () => newGame(1);
export const startDecisions = () => defaultDecisions(fresh());

/** The expected first day for a given number of pegawai, everything else as at the start. */
export function startingDay(staff = START.staff) {
  return expectedDay(fresh(), { ...startDecisions(), staff });
}

/**
 * WAGE. What a third pegawai adds to the day's sales income at the starting
 * setup, per hour of the day.
 */
export function wageByRule() {
  const margin = START.price - COSTS.ingredient;
  const gain = startingDay(3).demand - startingDay(2).demand;
  return { gain, margin, perDay: gain * margin, perHour: (gain * margin) / DAY.hours };
}

/**
 * The demand of a day: the portions it would sell with unlimited stock.
 * Simulated, because the stock decision needs the whole distribution and
 * not only its mean. Returned in ascending order.
 */
export function demandSample(state, decisions, days = 4000) {
  const { model } = expectedDay(state, decisions);
  const demands = [];
  for (let replication = 0; replication < days; replication++) {
    demands.push(new QueueSimulation({ ...model, seed: 777, replication }).run().served);
  }
  return demands.sort((a, b) => a - b);
}

/**
 * FIRST STOCK. The newsvendor model: how much to prepare of something that
 * spoils, when demand is uncertain.
 *
 * One portion too few loses its margin, p - v (underage cost). One portion
 * too many loses its cost, v (overage cost). Expected profit is largest when
 * the chance of selling out equals overage / (underage + overage), that is
 * when the stock is the quantile of demand at the critical ratio
 *
 *   (p - v) / ((p - v) + v) = (p - v) / p
 */
export function newsvendor(demands, price) {
  const margin = price - COSTS.ingredient;
  const criticalRatio = margin / price;
  const stock = demands[Math.min(demands.length - 1, Math.floor(criticalRatio * demands.length))];
  /** Mean sales income less the cost of the stock, for a given stock. */
  const incomeAt = (portions) =>
    demands.reduce(
      (total, demand) => total + price * Math.min(demand, portions) - COSTS.ingredient * portions,
      0,
    ) / demands.length;
  return { criticalRatio, stock, incomeAt, income: incomeAt(stock) };
}

/**
 * RENT. The starting setup, with the stock a newsvendor would prepare,
 * should keep STARTING_PROFIT_SHARE of its sales income as profit.
 */
export function rentByRule(demands = demandSample(fresh(), startDecisions())) {
  const { income } = newsvendor(demands, START.price);
  const wages = COSTS.wagePerHour * START.staff * DAY.hours;
  const fixedCostsAllowed = (1 - STARTING_PROFIT_SHARE) * income;
  return { income, wages, fixedCostsAllowed, rent: fixedCostsAllowed - wages };
}

/**
 * STARTING CASH. Enough to open on the first day and survive it even if not
 * one customer came: the first morning's ingredients, plus a day of wages
 * and rent.
 */
export function cashByRule() {
  const ingredients = COSTS.ingredient * START.stock;
  const wages = COSTS.wagePerHour * START.staff * DAY.hours;
  return { ingredients, wages, rent: COSTS.rent, cash: ingredients + wages + COSTS.rent };
}

/**
 * The expected course of a game under a fixed policy.
 *
 * Each day is replaced by its expectation from the analytic solver, and the
 * reputation is carried forward by its update rule. Stock is assumed to
 * match sales. It is an approximation of the average game (a mean-field
 * approximation), accurate enough to compare policies, and it is checked
 * against real games in scripts/balance.js.
 *
 * @param {object} state the warung on day 1
 * @param {object | ((state: object) => object)} policy decisions to override,
 *   the same every day or as a function of the state
 */
export function expectedCourse(state, policy = {}) {
  let current = { ...state };
  const days = [];
  for (let day = 1; day <= DAY.count; day++) {
    const overrides = typeof policy === 'function' ? policy(current) : policy;
    const decisions = { ...startDecisions(), seats: current.seatsOwned, ...overrides };
    const expected = expectedDay(current, decisions);
    days.push({ reputation: current.reputation, profit: expected.profit, score: expected.score });
    current = { ...current, reputation: nextReputation(current.reputation, expected.score) };
  }
  return {
    days,
    profit: days.reduce((total, day) => total + day.profit, 0),
    reputation: current.reputation,
  };
}

/** The most profitable fixed number of pegawai over the game, at a given price. */
export function bestFixedStaff(state, overrides = {}) {
  let best = { profit: -Infinity };
  for (let staff = 1; staff <= 5; staff++) {
    const course = expectedCourse(state, { ...overrides, staff });
    if (course.profit > best.profit) best = { ...course, staff };
  }
  return best;
}

/** The most profitable schedule of pegawai per shift over the game. */
export function bestShifts(state, overrides = {}) {
  const options = [1, 2, 3, 4];
  let best = { profit: -Infinity };
  for (const a of options) for (const b of options) for (const c of options) for (const d of options) {
    const course = expectedCourse(state, { ...overrides, shifts: [a, b, c, d] });
    if (course.profit > best.profit) best = { ...course, shifts: [a, b, c, d] };
  }
  return best;
}

/**
 * PURCHASES. What each purchase adds to the expected profit of the whole
 * game when it is owned from day 1, at the starting setup.
 *
 * The shift board is the exception to "at the starting setup": it only
 * changes anything once the schedule is changed, so its value is the best
 * schedule against the best fixed number of pegawai.
 */
export function purchaseValues() {
  const base = fresh();
  const baseline = expectedCourse(base).profit;
  const value = (state) => expectedCourse(state).profit - baseline;
  const withUpgrade = (id) => ({ ...base, upgrades: { ...base.upgrades, [id]: true } });

  const training = [1, 2, 3].map((level) => value({ ...base, trainingLevel: level }));
  const seats = [1, 2, 3, 4].map((added) => value({ ...base, seatsOwned: base.seatsOwned + added }));
  const fixedStaff = bestFixedStaff(base);
  const shifts = bestShifts(withUpgrade('shiftBoard'));

  return {
    cashRegister: value(withUpgrade('cashRegister')),
    queueNumbers: value(withUpgrade('queueNumbers')),
    // Each level against the level before it.
    training: training.map((total, i) => total - (training[i - 1] ?? 0)),
    // Each seat against one seat fewer.
    seats: seats.map((total, i) => total - (seats[i - 1] ?? 0)),
    shiftBoard: shifts.profit - fixedStaff.profit,
    shiftBoardDetail: { fixedStaff: fixedStaff.staff, shifts: shifts.shifts },
  };
}

/**
 * Plays whole games with a policy and summarizes how they end.
 *
 * @param {(state: object) => object} policy decisions to override each day
 */
export function playGames(policy, games = 300) {
  const finalCash = [];
  let bankrupt = 0;
  let reputation = 0;
  for (let game = 0; game < games; game++) {
    let state = newGame(1000 + game);
    while (state.status === STATUS.PLAYING) {
      const decisions = { ...defaultDecisions(state), ...policy(state) };
      // Nobody can prepare more than they can pay for.
      decisions.stock = Math.min(decisions.stock, Math.floor(state.cash / COSTS.ingredient));
      state = playDay(state, decisions).state;
    }
    if (state.status === STATUS.BANKRUPT) bankrupt++;
    finalCash.push(state.cash);
    reputation += state.reputation;
  }
  finalCash.sort((a, b) => a - b);
  return {
    games,
    meanCash: finalCash.reduce((total, cash) => total + cash, 0) / games,
    lowCash: finalCash[Math.floor(0.05 * games)],
    highCash: finalCash[Math.floor(0.95 * games)],
    bankruptShare: bankrupt / games,
    meanReputation: reputation / games,
  };
}

/** Four ways to run the warung, used to check that the game is neither a walkover nor hopeless. */
export const POLICIES = Object.freeze([
  { id: 'unchanged', name: 'never changes anything', policy: () => ({}) },
  { id: 'understaffed', name: 'one pegawai only', policy: () => ({ staff: 1, stock: 110 }) },
  { id: 'cheap', name: 'sells far too cheap', policy: () => ({ price: 8_000, stock: 195 }) },
  {
    // Raises the price, hires a third pegawai, and prepares what it expects to sell.
    id: 'careful',
    name: 'careful owner',
    policy: (state) => {
      const plan = { staff: 3, price: 13_000 };
      const expected = expectedDay(state, { ...defaultDecisions(state), ...plan });
      return { ...plan, stock: Math.round(expected.demand) };
    },
  },
]);
