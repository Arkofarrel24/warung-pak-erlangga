/**
 * Validation of the game layer against theory.
 *
 * validation-day.test.js checks the engine on a day built by hand. This test
 * checks the step before it: that the player's decisions are turned into the
 * right queueing model. A mid-game warung with every purchase in use is
 * simulated thousands of times, and the averages are compared with the
 * forecast, which gets its numbers from the analytic solver.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { COSTS } from '../src/game/config.js';
import { wagePerHour } from '../src/game/day.js';
import { expectedDay } from '../src/game/forecast.js';
import { defaultDecisions, newGame } from '../src/game/game.js';
import { dayScore } from '../src/game/reputation.js';
import { QueueSimulation } from '../src/sim/engine.js';

const DAYS = 8000;
const MAX_STANDARD_ERRORS = 4;

/** Reputation 72, one level of training, every upgrade, and a shift schedule. */
const state = {
  ...newGame(1),
  reputation: 72,
  trainingLevel: 1,
  seatsOwned: 5,
  upgrades: { cashRegister: true, queueNumbers: true, shiftBoard: true },
};
const decisions = { ...defaultDecisions(state), price: 12_500, shifts: [1, 3, 2, 3], seats: 4 };
const forecast = expectedDay(state, decisions);

const samples = { arrivals: [], served: [], reneged: [], rejected: [], totalQueueTime: [], totalStaffedTime: [], score: [], profit: [] };
for (let replication = 0; replication < DAYS; replication++) {
  const results = new QueueSimulation({ ...forecast.model, seed: 31_415, replication }).run();
  for (const key of ['arrivals', 'served', 'reneged', 'rejected', 'totalQueueTime', 'totalStaffedTime']) {
    samples[key].push(results[key]);
  }
  samples.score.push(dayScore(results));
  // Profit as the forecast defines it: as many portions prepared as were sold.
  samples.profit.push(
    (decisions.price - COSTS.ingredient) * results.served -
      wagePerHour(state) * results.totalStaffedTime -
      COSTS.rent,
  );
}

function meanAndError(values) {
  const mean = values.reduce((total, x) => total + x, 0) / values.length;
  const variance = values.reduce((total, x) => total + (x - mean) ** 2, 0) / (values.length - 1);
  return { mean, standardError: Math.sqrt(variance / values.length) };
}

function assertWithin(label, values, expected) {
  const { mean, standardError } = meanAndError(values);
  const apart = Math.abs(mean - expected) / standardError;
  assert.ok(
    apart < MAX_STANDARD_ERRORS,
    `${label}: forecast ${expected}, simulation ${mean} (${apart.toFixed(1)} standard errors)`,
  );
}

test('the model uses every purchase and decision', () => {
  const { model } = forecast;

  assert.equal(model.serviceRate, 12 * 1.15 * 1.2);
  assert.equal(model.patienceRate, 5 / 1.5);
  assert.equal(model.waitingRoom, 4);
  assert.deepEqual(model.staffSchedule, [
    { time: 0, servers: 1 },
    { time: 3, servers: 3 },
    { time: 6, servers: 2 },
    { time: 9, servers: 3 },
  ]);
  // Price factor e^(-2,500/7,000) times reputation factor 0.4 + 1.2 x 0.72.
  const factor = Math.exp(-2500 / 7000) * (0.4 + 1.2 * 0.72);
  assert.ok(Math.abs(model.arrivalProfile[4].rate - 32 * factor) < 1e-9);
});

test('simulated days match the forecast: customers', () => {
  assertWithin('arrivals', samples.arrivals, forecast.arrivals);
  assertWithin('served', samples.served, forecast.demand);
  assertWithin('gave up', samples.reneged, forecast.reneged);
  assertWithin('turned away', samples.rejected, forecast.rejected);
  assertWithin('time spent waiting', samples.totalQueueTime, forecast.theory.totalQueueTime);
  assertWithin('pegawai time at their post', samples.totalStaffedTime, forecast.theory.totalStaffedTime);
});

test('simulated days match the forecast: money', () => {
  assertWithin('profit', samples.profit, forecast.profit);

  const { mean } = meanAndError(samples.profit);
  assert.ok(Math.abs(mean - forecast.profit) / forecast.profit < 0.01, 'and to within 1%');
});

test('the forecast score is close to the average score', () => {
  // Not exactly equal: the score is a ratio, and the forecast takes the ratio
  // of two averages instead of the average of the ratio.
  const { mean } = meanAndError(samples.score);
  assert.ok(Math.abs(mean - forecast.score) < 0.5, `forecast ${forecast.score}, simulation ${mean}`);
});

test('the break-even point and the margin of safety agree with each other', () => {
  const margin = decisions.price - COSTS.ingredient;
  const fixedCosts = forecast.wages + forecast.rent;

  assert.ok(Math.abs(forecast.breakEvenCustomers - fixedCosts / margin) < 1e-9);
  // Selling exactly the break-even number of customers leaves no profit.
  assert.ok(Math.abs(margin * forecast.breakEvenCustomers - fixedCosts) < 1e-6);
  assert.ok(
    Math.abs(forecast.marginOfSafety - (forecast.demand - forecast.breakEvenCustomers) / forecast.demand) < 1e-12,
  );
});
