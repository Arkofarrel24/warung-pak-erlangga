/**
 * Validation of reneging in the simulation engine against the steady-state
 * formula for M/M/c/K+M.
 *
 * The method and the two pass conditions are those of validation.test.js:
 * 1. The relative difference between the simulation mean and theory is below 2%.
 * 2. The difference is no more than 4 standard errors.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze } from '../src/analytic/formulas.js';
import { confidenceInterval, runReplications } from '../src/sim/replications.js';
import { RUN_SETTINGS } from './reference-cases.js';

const MAX_RELATIVE_ERROR = 0.02;
const MAX_STANDARD_ERRORS = 4;
const DURATION = 4000;

function assertMatches(label, values, expected) {
  const { mean, stdDev, n } = confidenceInterval(values);
  const relativeError = Math.abs(mean - expected) / expected;
  const standardErrors = Math.abs(mean - expected) / (stdDev / Math.sqrt(n));
  assert.ok(
    relativeError < MAX_RELATIVE_ERROR && standardErrors < MAX_STANDARD_ERRORS,
    `${label}: theory ${expected}, simulation ${mean} ` +
      `(${(relativeError * 100).toFixed(2)}%, ${standardErrors.toFixed(1)} standard errors)`,
  );
}

function simulate(config) {
  const { warmup, replications, seed } = RUN_SETTINGS;
  return runReplications({ ...config, duration: DURATION, warmup, seed }, replications).runs;
}

/**
 * Compares the engine with theory on every measure that reneging touches.
 *
 * `theory.Wq` is the mean time in line over everyone who got in, so it is
 * compared with the engine's WqAll, not with its Wq (served customers only).
 */
function assertEngineMatches(runs, theory) {
  const column = (key) => runs.map((run) => run[key]);

  assertMatches('rho', column('rho'), theory.rho);
  assertMatches('L', column('L'), theory.L);
  assertMatches('Lq', column('Lq'), theory.Lq);
  assertMatches('P0', column('P0'), theory.P0);
  assertMatches('Wq of everyone who got in', column('WqAll'), theory.Wq);
  assertMatches('share who give up', column('renegeRate'), theory.renegeProbability);
  assertMatches(
    'customers served per hour',
    runs.map((run) => run.served / run.observedTime),
    theory.throughput,
  );
  if (theory.blockingProbability > 0) {
    assertMatches('share turned away', column('rejectionRate'), theory.blockingProbability);
  }
}

test('simulation matches theory: M/M/2+M with θ = μ, a Poisson number in the system', () => {
  // λ = 12, μ = θ = 4, c = 2. With θ = μ the number in the system is Poisson
  // with mean a = λ/μ = 3, so every figure below follows from e⁻³ alone.
  const e = Math.exp(-3);
  const busy = 2 - 5 * e; // P(N = 1) + 2·P(N >= 2)
  const theory = {
    rho: busy / 2, //                        0.8755
    L: 3,
    Lq: 3 - busy, //                         1.2489
    P0: e, //                                0.0498
    Wq: (3 - busy) / 12, //                  0.1041 hours
    renegeProbability: (4 * (3 - busy)) / 12, // 0.4163
    throughput: 4 * busy, //                 7.0043 per hour
    blockingProbability: 0,
  };

  assertEngineMatches(simulate({ arrivalRate: 12, serviceRate: 4, servers: 2, patienceRate: 4 }), theory);
});

const CROSS_CHECKS = [
  {
    name: 'overloaded M/M/1+M',
    config: { arrivalRate: 12, serviceRate: 10, servers: 1, patienceRate: 2 },
  },
  {
    name: 'busy M/M/3+M',
    config: { arrivalRate: 24, serviceRate: 10, servers: 3, patienceRate: 5 },
  },
  {
    name: 'overloaded M/M/2/6+M, balking and reneging together',
    config: { arrivalRate: 30, serviceRate: 10, servers: 2, capacity: 6, patienceRate: 4 },
  },
  {
    name: 'M/M/3/9+M, a warung at its lunch peak',
    config: { arrivalRate: 45, serviceRate: 15, servers: 3, waitingRoom: 6, patienceRate: 6 },
  },
  {
    // Two waiting seats, not four: with four, only 0.5% of customers are
    // turned away, too rare an event to estimate to within 2% in a run of
    // this length.
    name: 'lightly loaded M/M/2/4+M',
    config: { arrivalRate: 12, serviceRate: 10, servers: 2, capacity: 4, patienceRate: 4 },
  },
];

for (const { name, config } of CROSS_CHECKS) {
  test(`simulation matches the analytic module: ${name}`, () => {
    assertEngineMatches(simulate(config), analyze(config));
  });
}

test('customers are lost to reneging at rate θ·Lq', () => {
  // On average Lq customers are waiting, and each of them gives up at rate θ.
  // So in every replication the number who gave up per hour should equal θ
  // times that replication's own Lq, up to chance.
  const patienceRate = 5;
  const runs = simulate({ arrivalRate: 24, serviceRate: 10, servers: 3, patienceRate });
  const gap = runs.map((run) => run.reneged / run.observedTime - patienceRate * run.Lq);
  const { mean, stdDev, n } = confidenceInterval(gap);
  const lostPerHour = confidenceInterval(runs.map((run) => run.reneged / run.observedTime)).mean;

  assert.ok(lostPerHour > 1, 'the case does lose customers');
  assert.ok(
    Math.abs(mean) < MAX_STANDARD_ERRORS * (stdDev / Math.sqrt(n)),
    `gap ${mean} is more than ${MAX_STANDARD_ERRORS} standard errors from zero`,
  );
  assert.ok(Math.abs(mean) / lostPerHour < 0.005, `gap ${mean} against ${lostPerHour} per hour`);
});

test("Little's law holds with reneging, for the customers who got in", () => {
  const runs = simulate({ arrivalRate: 30, serviceRate: 10, servers: 2, capacity: 6, patienceRate: 4 });

  for (const run of runs) {
    const ratio = run.Lq / (run.effectiveArrivalRate * run.WqAll);
    // Only the handful of customers still in line when the run stops differ.
    assert.ok(Math.abs(ratio - 1) < 0.005, `Lq / (λ_eff·WqAll) = ${ratio}`);
  }
});
