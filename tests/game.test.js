/**
 * The game between days: what may be decided, how a day is played, and how
 * a game ends.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { COSTS, DAY, START } from '../src/game/config.js';
import {
  checkDecisions,
  defaultDecisions,
  newGame,
  playDay,
  PROBLEM,
  startDay,
  STATUS,
} from '../src/game/game.js';
import { nextReputation } from '../src/game/reputation.js';

const fresh = () => newGame(2026);
const codes = (state, decisions) => checkDecisions(state, decisions).map((problem) => problem.code);
const decide = (state, overrides) => ({ ...defaultDecisions(state), ...overrides });

// ---------------------------------------------------------------------------
// A new game
// ---------------------------------------------------------------------------

test('a new game starts on day 1 with the starting setup', () => {
  assert.deepEqual(fresh(), {
    version: 1,
    seed: 2026,
    day: 1,
    status: STATUS.PLAYING,
    cash: 1_550_000,
    reputation: 50,
    seatsOwned: 2,
    trainingLevel: 0,
    upgrades: { cashRegister: false, queueNumbers: false, shiftBoard: false },
    history: [],
  });
});

test('the seed must be a whole number that fits in 32 bits', () => {
  for (const seed of [-1, 1.5, 2 ** 32, Number.NaN, undefined, '7']) {
    assert.throws(() => newGame(seed), RangeError, String(seed));
  }
  assert.doesNotThrow(() => newGame(0));
  assert.doesNotThrow(() => newGame(2 ** 32 - 1));
});

test('the first day opens with decisions that can be played as they are', () => {
  const state = fresh();
  const decisions = defaultDecisions(state);

  assert.deepEqual(decisions, {
    staff: 2,
    shifts: null,
    price: 10_000,
    stock: 160,
    seats: 2,
    buy: { seats: 0, training: false, upgrades: [] },
  });
  assert.deepEqual(checkDecisions(state, decisions), []);
});

// ---------------------------------------------------------------------------
// What may be decided
// ---------------------------------------------------------------------------

test('each decision has its limits', () => {
  const state = fresh();
  const cases = [
    [{ staff: 0 }, PROBLEM.STAFF],
    [{ staff: 7 }, PROBLEM.STAFF],
    [{ staff: 2.5 }, PROBLEM.STAFF],
    [{ price: 4_500 }, PROBLEM.PRICE],
    [{ price: 25_500 }, PROBLEM.PRICE],
    [{ price: 10_250 }, PROBLEM.PRICE], // not a multiple of Rp 500
    [{ stock: -1 }, PROBLEM.STOCK],
    [{ stock: 601 }, PROBLEM.STOCK],
    [{ stock: 99.5 }, PROBLEM.STOCK],
    [{ seats: -1 }, PROBLEM.SEATS],
    [{ seats: 3 }, PROBLEM.SEATS], // only 2 are owned
  ];
  for (const [overrides, expected] of cases) {
    assert.deepEqual(codes(state, decide(state, overrides)), [expected], JSON.stringify(overrides));
  }
  assert.deepEqual(codes(state, decide(state, { staff: 6, price: 25_000, stock: 0, seats: 0 })), []);
});

test('problems come with the field they belong to', () => {
  const state = fresh();
  assert.deepEqual(checkDecisions(state, decide(state, { price: 123, stock: -5 })), [
    { field: 'price', code: PROBLEM.PRICE },
    { field: 'stock', code: PROBLEM.STOCK },
  ]);
});

test('a seat bought in the morning can be put out the same day', () => {
  const state = fresh();

  assert.deepEqual(codes(state, decide(state, { seats: 3, buy: { seats: 1 } })), []);
  assert.deepEqual(codes(state, decide(state, { seats: 4, buy: { seats: 1 } })), [PROBLEM.SEATS]);
  assert.deepEqual(codes(state, decide(state, { buy: { seats: 11 } })), [PROBLEM.SEATS_LIMIT]);
  assert.deepEqual(codes(state, decide(state, { buy: { seats: -1 } })), [PROBLEM.SEATS]);
});

test('an upgrade can be bought once, and only if it exists', () => {
  const state = fresh();
  const owned = { ...state, upgrades: { ...state.upgrades, cashRegister: true } };

  assert.deepEqual(codes(state, decide(state, { stock: 100, buy: { upgrades: ['cashRegister'] } })), []);
  assert.deepEqual(codes(owned, decide(owned, { buy: { upgrades: ['cashRegister'] } })), [PROBLEM.UPGRADE]);
  assert.deepEqual(codes(state, decide(state, { buy: { upgrades: ['teleporter'] } })), [PROBLEM.UPGRADE]);
  assert.deepEqual(
    codes(state, decide(state, { stock: 0, buy: { upgrades: ['queueNumbers', 'queueNumbers'] } })),
    [PROBLEM.UPGRADE],
  );
});

test('training stops at the highest level', () => {
  const trained = { ...fresh(), trainingLevel: 3 };

  assert.deepEqual(codes(trained, decide(trained, { buy: { training: true } })), [PROBLEM.TRAINING_MAXED]);
  assert.deepEqual(codes(fresh(), decide(fresh(), { stock: 100, buy: { training: true } })), []);
});

test('shifts need a shift board, which may be bought the same morning', () => {
  const state = fresh();
  const shifts = [1, 3, 2, 3];
  const boarded = { ...state, upgrades: { ...state.upgrades, shiftBoard: true } };

  assert.deepEqual(codes(state, decide(state, { shifts })), [PROBLEM.SHIFTS_LOCKED]);
  assert.deepEqual(codes(state, decide(state, { shifts, buy: { upgrades: ['shiftBoard'] } })), []);
  assert.deepEqual(codes(boarded, decide(boarded, { shifts })), []);
  assert.deepEqual(codes(boarded, decide(boarded, { shifts: [1, 3, 2] })), [PROBLEM.SHIFTS]);
  assert.deepEqual(codes(boarded, decide(boarded, { shifts: [1, 3, 0, 3] })), [PROBLEM.SHIFTS]);
  assert.deepEqual(codes(boarded, decide(boarded, { shifts: [1, 3, 7, 3] })), [PROBLEM.SHIFTS]);
});

test('the morning cannot cost more than the cash on hand', () => {
  const state = fresh();
  // Rp 1,550,000 buys 258 portions at Rp 6,000, and not one more.
  assert.deepEqual(codes(state, decide(state, { stock: 258 })), []);
  assert.deepEqual(codes(state, decide(state, { stock: 259 })), [PROBLEM.CASH]);
  // A cash register (Rp 550,000) leaves Rp 1,000,000: 166 portions.
  const withRegister = { buy: { upgrades: ['cashRegister'] } };
  assert.deepEqual(codes(state, decide(state, { ...withRegister, stock: 166 })), []);
  assert.deepEqual(codes(state, decide(state, { ...withRegister, stock: 167 })), [PROBLEM.CASH]);
});

// ---------------------------------------------------------------------------
// Playing a day
// ---------------------------------------------------------------------------

test('a day moves the game forward and leaves the earlier state untouched', () => {
  const state = fresh();
  const before = JSON.stringify(state);
  const { state: next, report } = playDay(state, defaultDecisions(state));

  assert.equal(JSON.stringify(state), before, 'the state passed in is not changed');
  assert.equal(next.day, 2);
  assert.equal(next.status, STATUS.PLAYING);
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0], report);
  assert.equal(report.day, 1);
  assert.equal(next.cash, report.ledger.cashAfter);
  assert.equal(next.reputation, report.reputationAfter);
  assert.equal(report.reputationBefore, 50);
  assert.equal(report.reputationAfter, nextReputation(50, report.score));
});

test("the day's accounts add up", () => {
  const state = fresh();
  const { report } = playDay(state, defaultDecisions(state));
  const { results, ledger, decisions } = report;

  assert.ok(results.arrivals > 100, 'a day at the warung has well over a hundred customers');
  assert.equal(
    results.arrivals,
    results.served + results.reneged + results.rejected + results.soldOut,
    'every customer is served, gives up, is turned away, or finds nothing left',
  );
  assert.equal(results.stockLeft, decisions.stock - results.served);
  assert.equal(ledger.revenue, decisions.price * results.served);
  assert.equal(ledger.ingredients, decisions.stock * COSTS.ingredient);
  assert.equal(ledger.waste, results.stockLeft * COSTS.ingredient);
  assert.equal(ledger.rent, COSTS.rent);
  assert.equal(ledger.profit, ledger.revenue - ledger.ingredients - ledger.wages - ledger.rent);
  assert.equal(ledger.cashAfter, ledger.cashBefore - ledger.purchases + ledger.profit);
  // Two pegawai for twelve hours, plus whatever it took to clear the last customers.
  assert.ok(ledger.wages >= 2 * 12 * COSTS.wagePerHour);
  assert.ok(ledger.wages < 2 * 13 * COSTS.wagePerHour);
  assert.equal(results.periods.length >= DAY.hours, true, 'one period per hour');
});

test('the same save and the same decisions give the same day', () => {
  const state = fresh();
  const decisions = defaultDecisions(state);

  assert.deepEqual(playDay(state, decisions), playDay(state, decisions));
});

test('another seed, or another day, is a different day', () => {
  const state = fresh();
  const decisions = defaultDecisions(state);
  const first = playDay(state, decisions).report.results;
  const otherSeed = playDay(newGame(2027), decisions).report.results;
  const secondDay = playDay({ ...state, day: 2 }, decisions).report.results;

  assert.notDeepEqual(otherSeed, first);
  assert.notDeepEqual(secondDay, first);
});

test('running the day event by event gives the same result as running it at once', () => {
  const state = fresh();
  const decisions = defaultDecisions(state);
  const day = startDay(state, decisions);

  assert.throws(() => day.finish(), /not ended/, 'the books cannot be closed while the warung is open');
  let events = 0;
  while (day.simulation.step()) events++;

  assert.ok(events > 300);
  assert.deepEqual(day.finish(), playDay(state, decisions));
});

test('decisions that break the rules cannot be played', () => {
  const state = fresh();
  assert.throws(() => playDay(state, decide(state, { staff: 0 })), RangeError);
  assert.throws(() => startDay(state, decide(state, { stock: 500 })), /CASH/);
});

test('what is bought in the morning is in use that day and is kept', () => {
  const state = fresh();
  const decisions = decide(state, {
    stock: 100,
    seats: 3,
    buy: { seats: 1, training: true, upgrades: ['queueNumbers'] },
  });
  const { state: next, report } = playDay(state, decisions);

  assert.equal(report.ledger.purchases, 75_000 + 325_000 + 90_000);
  assert.equal(report.setup.serviceRate, 12 * 1.15);
  assert.equal(report.setup.patienceRate, 5 / 1.5);
  assert.equal(report.setup.wagePerHour, 8_500 * 1.08);
  assert.equal(report.setup.seats, 3);
  assert.deepEqual(report.setup.staff, [2, 2, 2, 2]);
  assert.equal(next.seatsOwned, 3);
  assert.equal(next.trainingLevel, 1);
  assert.equal(next.upgrades.queueNumbers, true);
  assert.equal(next.cash, 1_550_000 - 490_000 + report.ledger.profit);
  // Nothing is bought twice: tomorrow's default decisions buy nothing.
  assert.deepEqual(defaultDecisions(next).buy, { seats: 0, training: false, upgrades: [] });
  assert.equal(defaultDecisions(next).seats, 3);
  assert.equal(defaultDecisions(next).stock, 100);
});

test('a state survives being saved as JSON', () => {
  let state = fresh();
  for (let day = 0; day < 3; day++) state = playDay(state, defaultDecisions(state)).state;

  // No NaN, Infinity, or undefined anywhere: what is saved is what is loaded.
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('a price change shows up in the number of customers', () => {
  const state = fresh();
  const arrivals = (price) => playDay(state, decide(state, { price })).report.results.arrivals;

  // Expected arrivals: 273 at Rp 8,000, 205 at Rp 10,000, 100 at Rp 15,000.
  assert.ok(arrivals(8_000) > arrivals(10_000));
  assert.ok(arrivals(10_000) > arrivals(15_000));
  assert.ok(arrivals(15_000) > 60 && arrivals(15_000) < 140);
});

// ---------------------------------------------------------------------------
// How a game ends
// ---------------------------------------------------------------------------

test('running out of cash ends the game', () => {
  // Rp 100,000 and nothing to sell: wages and rent cannot be paid in the evening.
  const state = { ...fresh(), cash: 100_000 };
  const { state: next, report } = playDay(state, decide(state, { stock: 0 }));

  assert.equal(report.ledger.revenue, 0);
  assert.ok(report.ledger.cashAfter < 0);
  assert.equal(next.status, STATUS.BANKRUPT);
  assert.equal(next.day, 1, 'the game stops on the day it went under');
  assert.deepEqual(codes(next, defaultDecisions(next)), [PROBLEM.GAME_OVER]);
  assert.throws(() => playDay(next, defaultDecisions(next)), RangeError);
});

test('a warung that sells nothing still scores its day', () => {
  const state = { ...fresh(), cash: 100_000 };
  const { report } = playDay(state, decide(state, { stock: 0 }));

  // Everyone was turned back at the door: half a point lost per customer.
  assert.equal(report.results.soldOut, report.results.arrivals);
  assert.equal(report.score, 0);
  assert.equal(report.reputationAfter, 35);
});

test('a game is won by getting through the last day', () => {
  let state = fresh();
  const days = [];
  while (state.status === STATUS.PLAYING) {
    days.push(state.day);
    // A sound way to run the place: a higher price and a third pegawai.
    state = playDay(state, decide(state, { staff: 3, price: 13_000, stock: 130 })).state;
  }

  assert.deepEqual(days, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(DAY.count, 14);
  assert.equal(state.status, STATUS.WON);
  assert.equal(state.day, 14);
  assert.equal(state.history.length, 14);
  assert.ok(state.cash > START.cash, 'and this way of running it makes money');
  assert.ok(state.reputation > 50, `reputation ${state.reputation} should have grown`);
  assert.deepEqual(codes(state, defaultDecisions(state)), [PROBLEM.GAME_OVER]);
});
