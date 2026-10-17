/**
 * The game between days: its state, the rules for what a player may decide,
 * and the step from one day to the next.
 *
 * Nothing here touches the DOM or the clock. A state is a plain object that
 * can be saved as JSON, and no function changes the state it is given: each
 * returns a new one. A day is simulated from (seed, day number), so the same
 * save and the same decisions always give the same day.
 */

import { QueueSimulation } from '../sim/engine.js';
import { challengeForDay, challengeMet } from './challenges.js';
import { CHALLENGES, DAY, LIMITS, REPUTATION, SHIFTS, STARS, START, TRAINING, UPGRADES } from './config.js';
import {
  applyPurchases,
  dayModel,
  patienceRate,
  purchaseCost,
  serviceRate,
  settle,
  staffPerShift,
  wagePerHour,
} from './day.js';
import { priceFactor, reputationFactor } from './demand.js';
import { eventForDay, ingredientCost, morningNews } from './events.js';
import { dayScore, nextReputation } from './reputation.js';
import { createGuestBook } from './reviews.js';
import { createTipJar } from './tips.js';

export const SAVE_VERSION = 1;

export const STATUS = Object.freeze({
  PLAYING: 'playing',
  WON: 'won',
  BANKRUPT: 'bankrupt',
});

/** Why a set of decisions cannot be played. The interface turns these into sentences. */
export const PROBLEM = Object.freeze({
  GAME_OVER: 'GAME_OVER',
  STAFF: 'STAFF',
  SHIFTS_LOCKED: 'SHIFTS_LOCKED',
  SHIFTS: 'SHIFTS',
  PRICE: 'PRICE',
  STOCK: 'STOCK',
  SEATS: 'SEATS',
  SEATS_LIMIT: 'SEATS_LIMIT',
  TRAINING_MAXED: 'TRAINING_MAXED',
  UPGRADE: 'UPGRADE',
  CASH: 'CASH',
});

const MAX_SEED = 0xffffffff;

/** @param {number} seed an integer from 0 to 2^32 - 1; it fixes every day of the game */
export function newGame(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`Seed must be an integer from 0 to ${MAX_SEED}.`);
  }
  return {
    version: SAVE_VERSION,
    seed,
    /** The day about to be played, 1 to DAY.count. */
    day: 1,
    status: STATUS.PLAYING,
    cash: START.cash,
    reputation: REPUTATION.start,
    seatsOwned: START.seats,
    trainingLevel: 0,
    upgrades: { cashRegister: false, queueNumbers: false, shiftBoard: false },
    /** One report per day played. */
    history: [],
  };
}

/** Yesterday's decisions again, or the starting setup on the first day. Nothing is bought. */
export function defaultDecisions(state) {
  const last = state.history.at(-1)?.decisions;
  return {
    staff: last?.staff ?? START.staff,
    shifts: last?.shifts ? [...last.shifts] : null,
    price: last?.price ?? START.price,
    stock: last?.stock ?? START.stock,
    seats: last?.seats ?? state.seatsOwned,
    buy: { seats: 0, training: false, upgrades: [] },
  };
}

function withDefaults(decisions) {
  return {
    staff: decisions.staff,
    shifts: decisions.shifts ? [...decisions.shifts] : null,
    price: decisions.price,
    stock: decisions.stock,
    seats: decisions.seats,
    buy: {
      seats: decisions.buy?.seats ?? 0,
      training: Boolean(decisions.buy?.training),
      upgrades: [...(decisions.buy?.upgrades ?? [])],
    },
  };
}

const isWholeNumberWithin = (value, { min, max }) =>
  Number.isInteger(value) && value >= min && value <= max;

/**
 * Checks a set of decisions against the rules.
 *
 * @returns {{ field: string, code: string }[]} empty when the day can be played
 */
export function checkDecisions(state, rawDecisions) {
  if (state.status !== STATUS.PLAYING) return [{ field: 'game', code: PROBLEM.GAME_OVER }];

  const decisions = withDefaults(rawDecisions);
  const { buy } = decisions;
  const problems = [];
  const report = (field, code) => problems.push({ field, code });

  // Purchases first: what is bought this morning is in use today.
  if (!Number.isInteger(buy.seats) || buy.seats < 0) report('buy.seats', PROBLEM.SEATS);
  else if (state.seatsOwned + buy.seats > LIMITS.seats.max) report('buy.seats', PROBLEM.SEATS_LIMIT);
  if (buy.training && state.trainingLevel >= TRAINING.length - 1) {
    report('buy.training', PROBLEM.TRAINING_MAXED);
  }
  const wanted = new Set(buy.upgrades);
  const validUpgrades =
    wanted.size === buy.upgrades.length &&
    buy.upgrades.every((id) => Object.hasOwn(UPGRADES, id) && !state.upgrades[id]);
  if (!validUpgrades) report('buy.upgrades', PROBLEM.UPGRADE);
  if (problems.length > 0) return problems;

  const equipped = applyPurchases(state, buy);

  if (!isWholeNumberWithin(decisions.staff, LIMITS.staff)) report('staff', PROBLEM.STAFF);
  if (decisions.shifts) {
    if (!equipped.upgrades.shiftBoard) {
      report('shifts', PROBLEM.SHIFTS_LOCKED);
    } else if (
      decisions.shifts.length !== SHIFTS.length ||
      !decisions.shifts.every((servers) => isWholeNumberWithin(servers, LIMITS.staff))
    ) {
      report('shifts', PROBLEM.SHIFTS);
    }
  }
  const { min, max, step } = LIMITS.price;
  if (!isWholeNumberWithin(decisions.price, { min, max }) || decisions.price % step !== 0) {
    report('price', PROBLEM.PRICE);
  }
  const stockIsValid = isWholeNumberWithin(decisions.stock, LIMITS.stock);
  if (!stockIsValid) report('stock', PROBLEM.STOCK);
  if (!isWholeNumberWithin(decisions.seats, { min: LIMITS.seats.min, max: equipped.seatsOwned })) {
    report('seats', PROBLEM.SEATS);
  }

  // Purchases and ingredients are paid in the morning, out of the cash on
  // hand. Wages and rent are paid in the evening, out of the day's takings.
  // An impossible stock is reported as such, not as a shortage of cash.
  if (stockIsValid) {
    // Today's price of ingredients is part of the morning's news.
    const perPortion = ingredientCost(morningNews(eventForDay(state.seed, state.day)));
    const morningCost = purchaseCost(state, buy) + perPortion * decisions.stock;
    if (morningCost > state.cash) report('cash', PROBLEM.CASH);
  }

  return problems;
}

/** Replaces every number that JSON cannot hold (NaN, Infinity) with null. */
function jsonSafe(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

/**
 * Opens the warung for the day.
 *
 * The simulation is returned unstarted, so the caller decides how to run it:
 * all at once with `simulation.run()`, or event by event for the animation.
 * Once it has finished, `finish()` closes the books and returns the next
 * state together with the day's report.
 *
 * `tips` is the day's tip jar (see tips.js). Whoever watches the day tells it
 * about the customers who leave and the coins picked up; a day that is not
 * watched simply ends with an empty jar.
 */
export function startDay(state, rawDecisions) {
  const problems = checkDecisions(state, rawDecisions);
  if (problems.length > 0) {
    throw new RangeError(`These decisions cannot be played: ${problems.map((p) => p.code).join(', ')}.`);
  }

  const decisions = withDefaults(rawDecisions);
  const equipped = applyPurchases(state, decisions.buy);
  const event = eventForDay(state.seed, state.day);
  const model = dayModel(equipped, decisions, event);
  const simulation = new QueueSimulation({
    ...model,
    stock: decisions.stock,
    seed: state.seed,
    // Each day gets its own random sequences.
    replication: state.day,
  });
  const tips = createTipJar(state.seed, state.day);
  const challenge = challengeForDay(state.seed, state.day);

  // The guest book reads every event as the engine reports it, however the
  // day is run: watched event by event, or all at once. It only reads.
  const guests = createGuestBook();
  const step = simulation.step.bind(simulation);
  simulation.step = () => {
    const record = step();
    guests.note(record);
    return record;
  };

  function finish() {
    if (!simulation.finished) throw new Error('The day has not ended yet.');

    const { WqByClass, ...kept } = simulation.results;
    const results = jsonSafe(kept);
    const ledger = settle(state, equipped, decisions, simulation.results, event, tips.amount);
    // The day's challenge, judged from the day's own totals. Its small reward
    // goes into the cash, not into the profit: it is not something the warung sold.
    const met = challengeMet(challenge, simulation.results);
    ledger.stamp = met ? CHALLENGES.reward : 0;
    ledger.cashAfter += ledger.stamp;
    const score = dayScore(simulation.results);
    const reputationAfter = nextReputation(state.reputation, score);

    const report = {
      day: state.day,
      decisions,
      // What the day brought unasked, or null on an ordinary day.
      event,
      // The queueing parameters the decisions turned into.
      setup: {
        serviceRate: serviceRate(equipped),
        patienceRate: patienceRate(equipped),
        wagePerHour: wagePerHour(equipped),
        staff: staffPerShift(equipped, decisions),
        seats: decisions.seats,
        priceFactor: priceFactor(decisions.price),
        reputationFactor: reputationFactor(state.reputation),
        ingredientCost: ingredientCost(event),
      },
      results,
      // The coins left on the counter, and how many of them were picked up.
      tips: { left: tips.left, taken: tips.taken },
      challenge: { id: challenge, met },
      // A few customers of the day, as the engine simulated them (see reviews.js).
      reviews: guests.pick(),
      ledger,
      score,
      reputationBefore: state.reputation,
      reputationAfter,
    };

    let { day } = state;
    let status = STATUS.PLAYING;
    if (ledger.cashAfter < 0) status = STATUS.BANKRUPT;
    else if (state.day >= DAY.count) status = STATUS.WON;
    else day += 1;

    return {
      state: {
        ...equipped,
        day,
        status,
        cash: ledger.cashAfter,
        reputation: reputationAfter,
        history: [...state.history, report],
      },
      report,
    };
  }

  return { simulation, model, decisions, event, tips, challenge, finish };
}

/**
 * How a game is rated once it has ended: no star for a warung that went
 * under, one for surviving, and up to three for the cash it ends with.
 */
export function stars(state) {
  if (state.status !== STATUS.WON) return 0;
  return 1 + (state.cash >= STARS.two ? 1 : 0) + (state.cash >= STARS.three ? 1 : 0);
}

/** Plays a whole day at once, without animation. */
export function playDay(state, decisions) {
  const day = startDay(state, decisions);
  day.simulation.run();
  return day.finish();
}
