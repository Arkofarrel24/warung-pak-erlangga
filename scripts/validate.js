/**
 * Prints a comparison of theory and simulation.
 * Run it with: npm run validate
 *
 * 1. The original M/M/c reference cases (textbook numbers).
 * 2. Reneging in steady state, against the M/M/c/K+M formula.
 * 3. One whole day, against the Kolmogorov forward equations.
 */

import { analyze } from '../src/analytic/formulas.js';
import { solveDay } from '../src/analytic/transient.js';
import { QueueSimulation } from '../src/sim/engine.js';
import { confidenceInterval, METRICS, runReplications } from '../src/sim/replications.js';
import { DAY_CASE, DAY_RUN } from '../tests/reference-cases-day.js';
import { REFERENCE_CASES, RUN_SETTINGS } from '../tests/reference-cases.js';

const LABELS = { rho: 'ρ', L: 'L', Lq: 'Lq', W: 'W (hours)', Wq: 'Wq (hours)', P0: 'P0' };

function printRow(label, expected, values) {
  const { mean, halfWidth, lower, upper } = confidenceInterval(values);
  const difference = ((mean - expected) / expected) * 100;
  const inside = lower <= expected && expected <= upper ? 'yes' : 'no';
  console.log(
    `  ${label.padEnd(26)}  ${expected.toFixed(4).padStart(9)}   ` +
      `${mean.toFixed(4).padStart(9)} ± ${halfWidth.toFixed(4)}`.padEnd(22) +
      `  ${(difference >= 0 ? '+' : '') + difference.toFixed(2)}%`.padEnd(10) +
      `  ${inside}`,
  );
}

const HEADER = `  ${'Metric'.padEnd(26)}  ${'Theory'.padStart(9)}   ${'Simulation (± 95% CI)'.padEnd(22)}  ${'Diff'.padEnd(8)}  Theory in CI`;

// ---------------------------------------------------------------------------
// 1. M/M/c, as in QueueLab
// ---------------------------------------------------------------------------

const { duration, warmup, replications, seed } = RUN_SETTINGS;
console.log('1. M/M/c REFERENCE CASES');
console.log(`   ${replications} replications x ${duration} hours, warm-up ${warmup} hours, seed ${seed}\n`);

for (const { name, config, theory } of REFERENCE_CASES) {
  const { runs } = runReplications({ ...config, duration, warmup, seed }, replications);
  console.log(name);
  console.log(HEADER);
  for (const metric of METRICS) {
    printRow(LABELS[metric], theory[metric], runs.map((run) => run[metric]));
  }
  console.log();
}

// ---------------------------------------------------------------------------
// 2. Reneging in steady state
// ---------------------------------------------------------------------------

const RENEGING_CASES = [
  {
    name: 'M/M/2+M, λ = 12, μ = θ = 4 (number in system is Poisson with mean 3)',
    config: { arrivalRate: 12, serviceRate: 4, servers: 2, patienceRate: 4 },
  },
  {
    name: 'M/M/3/9+M, λ = 45, μ = 15, θ = 6, six waiting seats (a lunch peak)',
    config: { arrivalRate: 45, serviceRate: 15, servers: 3, waitingRoom: 6, patienceRate: 6 },
  },
];

console.log('2. RENEGING IN STEADY STATE, M/M/c/K+M');
console.log(`   ${replications} replications x 4000 hours, warm-up ${warmup} hours\n`);

for (const { name, config } of RENEGING_CASES) {
  const theory = analyze(config);
  const { runs } = runReplications({ ...config, duration: 4000, warmup, seed }, replications);
  console.log(name);
  console.log(HEADER);
  printRow('ρ', theory.rho, runs.map((run) => run.rho));
  printRow('L', theory.L, runs.map((run) => run.L));
  printRow('Lq', theory.Lq, runs.map((run) => run.Lq));
  printRow('P0', theory.P0, runs.map((run) => run.P0));
  printRow('Wq, everyone (hours)', theory.Wq, runs.map((run) => run.WqAll));
  printRow('share who give up', theory.renegeProbability, runs.map((run) => run.renegeRate));
  if (theory.blockingProbability > 0) {
    printRow('share turned away', theory.blockingProbability, runs.map((run) => run.rejectionRate));
  }
  printRow('served per hour', theory.throughput, runs.map((run) => run.served / run.observedTime));
  console.log();
}

// ---------------------------------------------------------------------------
// 3. One day
// ---------------------------------------------------------------------------

console.log('3. ONE DAY: λ(t), balking, reneging, staff schedule, closing time');
console.log(`   ${DAY_RUN.replications.toLocaleString('en-US')} simulated days against the Kolmogorov forward equations\n`);

const started = performance.now();
const theory = solveDay(DAY_CASE);
const solverMs = performance.now() - started;

const openHours = DAY_CASE.closingTime / DAY_CASE.periodLength;
const days = [];
const simulationStarted = performance.now();
for (let day = 0; day < DAY_RUN.replications; day++) {
  days.push(new QueueSimulation({ ...DAY_CASE, seed: DAY_RUN.seed, replication: day }).run());
}
const simulationMs = performance.now() - simulationStarted;

console.log(HEADER);
for (const [label, key, scale = 1] of [
  ['customers arriving', 'arrivals'],
  ['served', 'served'],
  ['turned away (balking)', 'rejected'],
  ['gave up (reneging)', 'reneged'],
  ['waiting, customer-hours', 'totalQueueTime'],
  ['serving, server-hours', 'totalBusyTime'],
  ['at post, server-hours', 'totalStaffedTime'],
  ['overtime (minutes)', 'overtime', 60],
]) {
  printRow(label, theory[key] * scale, days.map((day) => day[key] * scale));
}

console.log('\n  Per hour: theory / simulation mean');
console.log('  hour   λ/(cμ)   arriving         served           turned away     gave up');
for (let hour = 0; hour < openHours; hour++) {
  const expected = theory.periods[hour];
  const cell = (key) => {
    const mean = days.reduce((total, day) => total + (day.periods[hour]?.[key] ?? 0), 0) / days.length;
    return `${expected[key].toFixed(2).padStart(6)} /${mean.toFixed(2).padStart(6)}`;
  };
  console.log(
    `  ${String(hour).padStart(2)}-${String(hour + 1).padEnd(2)}  ${expected.trafficIntensity.toFixed(2).padStart(6)}   ` +
      `${cell('arrivals')}   ${cell('served')}   ${cell('rejected')}   ${cell('reneged')}`,
  );
}
console.log(
  `\n  (solver ${solverMs.toFixed(0)} ms, ${DAY_RUN.replications.toLocaleString('en-US')} simulated days ${simulationMs.toFixed(0)} ms)`,
);
