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
 *   tips           every coin of a day is worth a quarter of that day's profit
 *   growth         the second week brings a careful owner's lunch peak back to capacity
 *   challenges     each threshold is a careful owner's median day; all stamps are worth one day's profit
 */

import { COSTS, DAY, DEMAND, EVENTS, GROWTH, LIMITS, SERVICE, START, TIPS } from '../src/game/config.js';
import { eventForDay, ingredientCost, morningNews } from '../src/game/events.js';
import { expectedDay } from '../src/game/forecast.js';
import { defaultDecisions, newGame, playDay, startDay, STATUS } from '../src/game/game.js';
import { priceFactor, reputationFactor } from '../src/game/demand.js';
import { nextReputation } from '../src/game/reputation.js';
import { lostCustomers, stockMiss } from '../src/game/challenges.js';
import { servedAtOnce } from '../src/game/tips.js';
import { EVENT, QueueSimulation } from '../src/sim/engine.js';

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
/** The second week's rent rise, as a multiple of what the starting setup earns in a day. */
export const RENT_RISE_FACTOR = 1.5;
const RENT_STEP = 25_000;

/**
 * The rent rise of the second week, by the rule in config.js: enough to turn
 * the expected profit of the starting setup into a loss of half its size.
 */
export function rentRiseByRule() {
  const { profit } = expectedDay(fresh(), startDecisions());
  return { profit, rise: Math.round((RENT_RISE_FACTOR * profit) / RENT_STEP) * RENT_STEP };
}

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

/** The careful owner the growth of the second week is measured against. */
export const CAREFUL = Object.freeze({ staff: 3, price: 13_000 });

/**
 * GROWTH. By the second week a careful owner has a higher price and a good
 * name, and the lunch peak no longer fills the counter. The growth factor is
 * what brings the traffic intensity of that hour, a = λ ÷ (c·μ), back to 1.
 *
 * The reputation is the one the expected course gives on the morning the
 * growth starts; the course itself is computed without the growth up to
 * that day, so the rule does not depend on its own answer.
 */
export function growthByRule() {
  const reputation = expectedCourse(fresh(), CAREFUL).days[GROWTH.fromDay - 1].reputation;
  const peak = Math.max(...DEMAND.baseProfile) * priceFactor(CAREFUL.price) * reputationFactor(reputation);
  const capacity = CAREFUL.staff * SERVICE.baseRate;
  return { reputation, peak, capacity, intensity: peak / capacity, exact: capacity / peak, factor: Math.round((capacity / peak) * 10) / 10 };
}

/** A full day of tips is worth this share of what the starting setup earns in a day. */
export const TIPS_PROFIT_SHARE = 0.25;
const TIP_CHANCE_STEP = 0.05;

/**
 * How many customers a day are served the moment they arrive, at the
 * starting setup with its first day's stock. Simulated: the solver knows how
 * long customers wait on average, not how many of them did not wait at all.
 */
export function servedAtOnceSample(days = 2000) {
  const { model } = expectedDay(fresh(), startDecisions());
  let count = 0;
  for (let replication = 0; replication < days; replication++) {
    const simulation = new QueueSimulation({ ...model, stock: START.stock, seed: 777, replication });
    while (!simulation.finished) {
      const record = simulation.step();
      if (record?.type === EVENT.DEPARTURE && servedAtOnce(record.customer)) count++;
    }
  }
  return count / days;
}

/**
 * TIPS. The chance that a customer who is served at once leaves a coin, such
 * that every coin of a day comes to TIPS_PROFIT_SHARE of that day's profit.
 */
export function tipsByRule() {
  const { profit } = expectedDay(fresh(), startDecisions());
  const servedAtOnce = servedAtOnceSample();
  const coins = (TIPS_PROFIT_SHARE * profit) / TIPS.amount;
  const exact = coins / servedAtOnce;
  // Counted in steps, so that 0.2 comes out as 0.2 and not as 4 x 0.05.
  const chance = Math.round(exact / TIP_CHANCE_STEP) / Math.round(1 / TIP_CHANCE_STEP);
  return { profit, servedAtOnce, coins, exact, chance, perDay: chance * servedAtOnce * TIPS.amount };
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
    current = { ...current, day: day + 1, reputation: nextReputation(current.reputation, expected.score) };
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
  for (let staff = LIMITS.staff.min; staff <= LIMITS.staff.max; staff++) {
    const course = expectedCourse(state, { ...overrides, staff });
    if (course.profit > best.profit) best = { ...course, staff };
  }
  return best;
}

/** The most profitable schedule of pegawai per shift over the game. */
export function bestShifts(state, overrides = {}) {
  // With the busier second week a shift can need more than four; one pegawai is never the best for a whole shift.
  const options = [2, 3, 4, 5, 6];
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
 * EVENTS. What each event does to the expected profit of the starting setup,
 * against the same day without it. Events that strike at a moment are placed
 * in the middle of the hours in which they can happen.
 *
 * Stock is assumed to match sales, as everywhere in the expected values. For
 * the two changes in demand that is generous: a player who does not adjust
 * the stock gains less from a busy day and loses more on a quiet one.
 */
export function eventEffects() {
  const state = fresh();
  const decisions = startDecisions();
  const ordinary = expectedDay(state, decisions);
  const effects = Object.entries(EVENTS.catalog).map(([id, spec]) => {
    const event = { id, kind: spec.kind };
    if (spec.earliest !== undefined) event.time = (spec.earliest + spec.latest) / 2;
    const day = expectedDay(state, decisions, event);
    return { id, kind: spec.kind, profit: day.profit, effect: day.profit - ordinary.profit, score: day.score };
  });
  const mean = effects.reduce((total, item) => total + item.effect, 0) / effects.length;
  return {
    ordinary,
    effects,
    /** Mean effect of an event, given that one happens. */
    mean,
    /** Mean effect per day, events and ordinary days together. */
    perDay: mean * EVENTS.chance,
  };
}

/**
 * CHALLENGES. The median day of a careful owner, on each measure a challenge
 * uses, and the reward that makes all fourteen stamps worth one ordinary
 * day's expected profit at the starting setup.
 */
export function challengesByRule(games = 200) {
  const careful = POLICIES.find((item) => item.id === 'careful').policy;
  const days = { servedShare: [], reneged: [], lost: [], stockMiss: [] };
  for (let game = 0; game < games; game++) {
    let state = newGame(1000 + game);
    while (state.status === STATUS.PLAYING) {
      const decisions = { ...defaultDecisions(state), ...careful(state) };
      const perPortion = ingredientCost(morningNews(eventForDay(state.seed, state.day)));
      decisions.stock = Math.min(decisions.stock, Math.floor(state.cash / perPortion));
      const { state: next, report } = playDay(state, decisions);
      const { results } = report;
      days.servedShare.push(results.served / results.arrivals);
      days.reneged.push(results.reneged);
      days.lost.push(lostCustomers(results));
      days.stockMiss.push(stockMiss(results));
      state = next;
    }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const { profit } = expectedDay(fresh(), startDecisions());
  return {
    // Rounded down to a step of 5%: "nine in ten" is a goal, "90.8%" is not.
    servedShare: Math.floor(median(days.servedShare) * 20) / 20,
    reneged: median(days.reneged),
    lost: median(days.lost),
    stockMiss: median(days.stockMiss),
    profit,
    reward: Math.floor(profit / DAY.count / 1000) * 1000,
  };
}

/**
 * Plays a day the way the most attentive player could: every coin a customer
 * leaves on the counter is picked up the moment it is left. It is the most
 * that tips can ever add to a day.
 */
export function playDayTakingEveryTip(state, decisions) {
  const day = startDay(state, decisions);
  while (!day.simulation.finished) {
    const record = day.simulation.step();
    if (record?.type !== EVENT.DEPARTURE) continue;
    const coin = day.tips.leave(record.customer, record.time);
    if (coin) day.tips.take(coin.id, record.time);
  }
  return day.finish();
}

/**
 * Plays whole games with a policy and summarizes how they end.
 *
 * @param {(state: object) => object} policy decisions to override each day
 * @param {number} [games]
 * @param {object} [options]
 * @param {boolean} [options.tips] every coin of every day is picked up; without it, none is
 */
export function playGames(policy, games = 300, { tips = false } = {}) {
  const play = tips ? playDayTakingEveryTip : playDay;
  const finalCash = [];
  let bankrupt = 0;
  let reputation = 0;
  let tipsTaken = 0;
  for (let game = 0; game < games; game++) {
    let state = newGame(1000 + game);
    while (state.status === STATUS.PLAYING) {
      const decisions = { ...defaultDecisions(state), ...policy(state) };
      // Nobody can prepare more than they can pay for, at today's price of ingredients.
      const perPortion = ingredientCost(morningNews(eventForDay(state.seed, state.day)));
      decisions.stock = Math.min(decisions.stock, Math.floor(state.cash / perPortion));
      state = play(state, decisions).state;
    }
    if (state.status === STATUS.BANKRUPT) bankrupt++;
    finalCash.push(state.cash);
    reputation += state.reputation;
    tipsTaken += state.history.reduce((total, report) => total + report.ledger.tips, 0);
  }
  finalCash.sort((a, b) => a - b);
  return {
    games,
    /** Mean rupiah of tips picked up over a game. */
    meanTips: tipsTaken / games,
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
  {
    // The starting setup, except that the stock follows the morning's news:
    // less on a rainy day, more on payday. Surprises cannot be planned for.
    id: 'newsreader',
    name: 'only heeds the news',
    policy: (state) => {
      const news = morningNews(eventForDay(state.seed, state.day));
      const expected = expectedDay(state, defaultDecisions(state), news);
      return { stock: Math.round(expected.demand * 0.97) };
    },
  },
  { id: 'understaffed', name: 'one pegawai only', policy: () => ({ staff: 1, stock: 110 }) },
  { id: 'cheap', name: 'sells far too cheap', policy: () => ({ price: 8_000, stock: 195 }) },
  {
    // Raises the price, hires a third pegawai, and prepares what it expects to sell.
    id: 'careful',
    name: 'careful owner',
    policy: (state) => {
      const plan = { ...CAREFUL };
      const expected = expectedDay(state, { ...defaultDecisions(state), ...plan });
      return { ...plan, stock: Math.round(expected.demand) };
    },
  },
]);
