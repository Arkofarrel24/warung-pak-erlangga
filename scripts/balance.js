/**
 * Where the game's numbers come from.
 * Run it with: npm run balance
 *
 * Every balance number in src/game/config.js follows from the model by a
 * stated rule (see scripts/derive.js). This script redoes that working and
 * prints it next to the number the game uses, then checks the result by
 * playing whole games. Expected values come from the analytic solver, with
 * no randomness; distributions and whole games are simulated.
 */

import {
  COSTS,
  DAY,
  DEMAND,
  EVENTS,
  RENT_RISE,
  SEAT_COST,
  SHIFTS,
  STARS,
  START,
  TRAINING,
  UPGRADES,
} from '../src/game/config.js';
import { expectedDay } from '../src/game/forecast.js';
import {
  cashByRule,
  demandSample,
  eventEffects,
  expectedCourse,
  fresh,
  newsvendor,
  playGames,
  POLICIES,
  PURCHASE_PRICE_SHARE,
  purchaseValues,
  rentByRule,
  startDecisions,
  startingDay,
  STARTING_PROFIT_SHARE,
  wageByRule,
  rentRiseByRule,
  RENT_RISE_FACTOR,
} from './derive.js';

const rupiah = (amount) => `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
const thousands = (amount) => (amount / 1000).toFixed(0).padStart(6);
const fixed = (value, digits = 1, width = 7) => value.toFixed(digits).padStart(width);
const heading = (title) => console.log(`\n${'='.repeat(84)}\n${title}\n${'='.repeat(84)}`);
const hourLabel = (hour) => `${String(DAY.openHour + hour).padStart(2, '0')}h`;

const state = fresh();
const decisions = startDecisions();
const margin = START.price - COSTS.ingredient;

// ---------------------------------------------------------------------------
heading(`1. THE STARTING SETUP: ${START.staff} pegawai, ${rupiah(START.price)}, ${START.seats} waiting seats, reputation 50`);
// ---------------------------------------------------------------------------

const start = startingDay();
console.log(`  customers arriving      ${fixed(start.arrivals)}`);
console.log(`  served (the "demand")   ${fixed(start.demand)}`);
console.log(`  gave up (reneging)      ${fixed(start.reneged)}`);
console.log(`  turned away (balking)   ${fixed(start.rejected)}`);
console.log(`  day score               ${fixed(start.score)}`);
console.log('\n  Offered load λ/(cμ) by hour; above 1 the line must grow:');
const loads = start.theory.periods.slice(0, DAY.hours);
console.log('  ' + loads.map((period, hour) => `${hourLabel(hour)} ${period.trafficIntensity.toFixed(2)}`).join('  '));

// ---------------------------------------------------------------------------
heading('2. WAGE: a third pegawai should just pay for itself on the day');
// ---------------------------------------------------------------------------

console.log('  pegawai   served   gave up   turned away   score   sales income');
for (const staff of [1, 2, 3, 4, 5]) {
  const day = startingDay(staff);
  console.log(
    `  ${String(staff).padStart(4)}    ${fixed(day.demand)}  ${fixed(day.reneged)}      ${fixed(day.rejected)}   ` +
      `${fixed(day.score)}   ${rupiah(day.contribution).padStart(12)}`,
  );
}
const wage = wageByRule();
console.log(`\n  The third pegawai adds ${wage.gain.toFixed(1)} served customers x ${rupiah(wage.margin)} = ${rupiah(wage.perDay)} a day,`);
console.log(`  which is ${rupiah(wage.perHour)} an hour.`);
console.log(`  -> wage in the game: ${rupiah(COSTS.wagePerHour)} an hour.`);
console.log('  On the day the third pegawai is a wash. What it buys is reputation: see the score.');

// ---------------------------------------------------------------------------
heading('3. FIRST STOCK: the newsvendor model');
// ---------------------------------------------------------------------------

const demands = demandSample(state, decisions);
const mean = demands.reduce((total, x) => total + x, 0) / demands.length;
const sd = Math.sqrt(demands.reduce((total, x) => total + (x - mean) ** 2, 0) / (demands.length - 1));
const quantile = (q) => demands[Math.min(demands.length - 1, Math.floor(q * demands.length))];
const vendor = newsvendor(demands, START.price);

console.log('  Portions sold = min(demand, stock), where demand is what the day would sell with');
console.log(`  unlimited stock. Demand over ${demands.length.toLocaleString('en-US')} simulated days at the starting setup:`);
console.log(`    mean ${mean.toFixed(1)} (solver: ${start.demand.toFixed(1)}), standard deviation ${sd.toFixed(1)}`);
console.log(`    5%: ${quantile(0.05)}   25%: ${quantile(0.25)}   50%: ${quantile(0.5)}   75%: ${quantile(0.75)}   95%: ${quantile(0.95)}`);
console.log(`\n  A portion too few loses its margin, ${rupiah(margin)}. A portion too many loses its cost, ${rupiah(COSTS.ingredient)}.`);
console.log(`  Critical ratio = ${margin} / (${margin} + ${COSTS.ingredient}) = ${vendor.criticalRatio.toFixed(2)}:`);
console.log(`  prepare the ${(vendor.criticalRatio * 100).toFixed(0)}% quantile of demand, which is ${vendor.stock} portions.`);
console.log(`  -> first-day stock in the game: ${START.stock} portions.`);
console.log('\n    stock    sales less ingredients   thrown away   customers short');
for (const stock of [...new Set([vendor.stock - 20, vendor.stock - 10, vendor.stock, START.stock, vendor.stock + 10, vendor.stock + 20, vendor.stock + 40])].sort((a, b) => a - b)) {
  const waste = demands.reduce((total, d) => total + Math.max(stock - d, 0), 0) / demands.length;
  const short = demands.reduce((total, d) => total + Math.max(d - stock, 0), 0) / demands.length;
  const mark = stock === vendor.stock ? ' *' : '  ';
  console.log(`    ${String(stock).padStart(4)}${mark}      ${rupiah(vendor.incomeAt(stock)).padStart(12)}        ${fixed(waste)}         ${fixed(short)}`);
}
console.log(`  With perfect foresight the income would be ${rupiah(start.contribution)}: uncertainty costs ${rupiah(start.contribution - vendor.income)} a day.`);

// ---------------------------------------------------------------------------
heading(`4. RENT: the starting setup should keep ${STARTING_PROFIT_SHARE * 100}% of its sales income`);
// ---------------------------------------------------------------------------

const rent = rentByRule(demands);
console.log(`  sales less ingredients at the best stock      ${rupiah(rent.income).padStart(12)}`);
console.log(`  fixed costs allowed (${(1 - STARTING_PROFIT_SHARE) * 100}%)                     ${rupiah(rent.fixedCostsAllowed).padStart(12)}`);
console.log(`  less wages, ${START.staff} pegawai x ${DAY.hours} hours               ${rupiah(rent.wages).padStart(12)}`);
console.log(`  leaves for rent                               ${rupiah(rent.rent).padStart(12)}`);
console.log(`  -> rent in the game: ${rupiah(COSTS.rent)} a day.`);
const fixedCosts = COSTS.rent + rent.wages;
console.log(`\n  Break-even point: (${rupiah(COSTS.rent)} + ${rupiah(rent.wages)}) / ${rupiah(margin)} = ${(fixedCosts / margin).toFixed(0)} customers a day.`);
console.log(`  Expected: ${start.demand.toFixed(0)} served. Margin of safety: ${((1 - fixedCosts / start.contribution) * 100).toFixed(0)}% before stock losses, ${((1 - fixedCosts / rent.income) * 100).toFixed(0)}% after.`);
console.log(`  Expected profit of the starting setup: ${rupiah(vendor.incomeAt(START.stock) - fixedCosts)} a day.`);

// ---------------------------------------------------------------------------
heading('5. STARTING CASH: one full day of costs with no income');
// ---------------------------------------------------------------------------

const cash = cashByRule();
console.log(`  ingredients ${rupiah(cash.ingredients)} + wages ${rupiah(cash.wages)} + rent ${rupiah(cash.rent)} = ${rupiah(cash.cash)}`);
console.log(`  -> cash in the game: ${rupiah(START.cash)}.`);
console.log('  Ingredients are paid each morning out of cash. Whoever lets cash fall below the cost');
console.log('  of a day\'s stock has to prepare less, sells less, and falls further behind.');

// ---------------------------------------------------------------------------
heading('6. PRICE: expected profit a day in thousands of rupiah, on day 1');
// ---------------------------------------------------------------------------

console.log(`  With unlimited capacity the best price would be v + s = ${rupiah(COSTS.ingredient + DEMAND.priceSensitivity)}.`);
console.log('  The fewer the pegawai, the more congested the warung and the higher its best price.\n');
console.log('   price   customers |' + [1, 2, 3, 4].map((staff) => ` ${staff} pegawai`).join(' |'));
const bestPrice = [1, 2, 3, 4].map(() => ({ profit: -Infinity }));
for (let price = 8000; price <= 18000; price += 1000) {
  const days = [1, 2, 3, 4].map((staff) => expectedDay(state, { ...decisions, staff, price }));
  days.forEach((day, i) => {
    if (day.profit > bestPrice[i].profit) bestPrice[i] = { profit: day.profit, price };
  });
  console.log(`  ${String(price).padStart(6)}    ${fixed(days[0].arrivals, 0, 6)}   |` + days.map((day) => `  ${thousands(day.profit)}  `).join(' |'));
}
console.log('  best price          |' + bestPrice.map((best) => `  ${String(best.price).padStart(6)}  `).join(' |'));

// ---------------------------------------------------------------------------
heading(`7. PURCHASES: priced at ${PURCHASE_PRICE_SHARE * 100}% of what they bring over ${DAY.count} days when bought on day 1`);
// ---------------------------------------------------------------------------

const values = purchaseValues();
console.log('  purchase                              brings over the game    price by rule    price in game');
const purchaseRow = (label, value, price) =>
  console.log(
    `  ${label.padEnd(36)} ${rupiah(value).padStart(16)}      ${(value > 0 ? rupiah(value * PURCHASE_PRICE_SHARE) : 'not worth it').padStart(12)}     ${rupiah(price).padStart(12)}`,
  );
purchaseRow(`cash register (μ x ${UPGRADES.cashRegister.serviceFactor})`, values.cashRegister, UPGRADES.cashRegister.cost);
purchaseRow(`queue numbers (patience x ${UPGRADES.queueNumbers.patienceFactor})`, values.queueNumbers, UPGRADES.queueNumbers.cost);
values.training.forEach((value, i) =>
  purchaseRow(`training level ${i + 1} (μ x ${TRAINING[i + 1].serviceFactor}, wage x ${TRAINING[i + 1].wageFactor})`, value, TRAINING[i + 1].cost),
);
values.seats.forEach((value, i) => purchaseRow(`waiting seat number ${START.seats + i + 1}`, value, SEAT_COST));
purchaseRow('shift board', values.shiftBoard, UPGRADES.shiftBoard.cost);
const { fixedStaff, shifts } = values.shiftBoardDetail;
console.log(`\n  Shift board: best schedule (${SHIFTS.map((shift, i) => `${shift.id} ${shifts[i]}`).join(', ')}) against the best fixed number (${fixedStaff}).`);
console.log('  Seats stop paying after the first few: a customer far back in the line is more');
console.log('  likely to give up than to be served, and giving up hurts more than being turned away.');

// ---------------------------------------------------------------------------
heading(`8. ${DAY.count} DAYS: is the game a walkover, or hopeless?`);
// ---------------------------------------------------------------------------

console.log('  Expected course, from the solver (stock assumed to match sales):\n');
console.log('  policy                     reputation: day 1   day 7   day 14    profit: day 1      day 14    over the game');
for (const { name, policy } of POLICIES) {
  const course = expectedCourse(state, policy);
  const [first, middle, last] = [course.days[0], course.days[6], course.days.at(-1)];
  console.log(
    `  ${name.padEnd(25)} ${fixed(first.reputation, 0, 17)} ${fixed(middle.reputation, 0)} ${fixed(last.reputation, 0, 8)}` +
      `   ${rupiah(first.profit).padStart(14)} ${rupiah(last.profit).padStart(11)} ${rupiah(course.profit).padStart(16)}`,
  );
}

console.log('\n  The same policies played for real, 300 games each. Stock now runs out or is thrown away,');
console.log('  events happen (section 9), and a game ends early when cash drops below zero.');
console.log(`  Everyone starts with ${rupiah(START.cash)}.\n`);
console.log('  policy                     mean final cash       worst 5%        best 5%    went bankrupt   reputation');
for (const { name, policy } of POLICIES) {
  const outcome = playGames(policy);
  console.log(
    `  ${name.padEnd(25)} ${rupiah(outcome.meanCash).padStart(16)} ${rupiah(outcome.lowCash).padStart(14)} ${rupiah(outcome.highCash).padStart(14)}` +
      `      ${(outcome.bankruptShare * 100).toFixed(0).padStart(5)} %      ${outcome.meanReputation.toFixed(0).padStart(5)}`,
  );
}

// ---------------------------------------------------------------------------
heading('9. EVENTS: good and bad should roughly cancel');
// ---------------------------------------------------------------------------

const events = eventEffects();
console.log(`  The starting setup on an ordinary day: expected profit ${rupiah(events.ordinary.profit)}, score ${events.ordinary.score.toFixed(0)}.`);
console.log(`  From day ${EVENTS.firstDay} on, a day brings one of these with probability ${EVENTS.chance}:\n`);
console.log('  event              kind        expected profit      effect     score');
for (const item of events.effects) {
  console.log(
    `  ${item.id.padEnd(18)} ${item.kind.padEnd(9)} ${rupiah(item.profit).padStart(16)} ${((item.effect >= 0 ? '+' : '') + rupiah(item.effect)).padStart(13)}   ${item.score.toFixed(0).padStart(5)}`,
  );
}
console.log(`\n  Mean effect of an event: ${rupiah(events.mean)}. Per day, events and ordinary days together: ${rupiah(events.perDay)},`);
console.log(`  against a sales income of ${rupiah(events.ordinary.contribution)} a day.`);

// ---------------------------------------------------------------------------
heading('10. THE SECOND WEEK: standing still stops being safe');
// ---------------------------------------------------------------------------

const rise = rentRiseByRule();
console.log(`  The starting setup is expected to earn ${rupiah(rise.profit)} on an ordinary day.`);
console.log(`  Rule: from day ${RENT_RISE.fromDay} the rent rises by ${RENT_RISE_FACTOR} times that, rounded: ${rupiah(rise.rise)}.`);
console.log(`  -> rent rise in the game: ${rupiah(RENT_RISE.amount)}, from ${rupiah(COSTS.rent)} to ${rupiah(COSTS.rent + RENT_RISE.amount)} a day.`);
console.log(`  The same setup then earns ${rupiah(rise.profit - RENT_RISE.amount)} a day: what was a thin profit is a thin loss.`);
console.log('  (The whole-game table in section 8 already includes the rise.)');

// ---------------------------------------------------------------------------
heading('11. STARS: what the end of a game is worth');
// ---------------------------------------------------------------------------

const still = playGames(POLICIES.find((item) => item.id === 'unchanged').policy);
const careful = playGames(POLICIES.find((item) => item.id === 'careful').policy);
console.log('  One star for surviving the fourteen days.');
console.log(`  Two stars from ${rupiah(STARS.two)} (${STARS.two / START.cash} x the starting cash):`);
console.log(`    the best 5% of players who never change anything end on ${rupiah(still.highCash)}.`);
console.log(`  Three stars from ${rupiah(STARS.three)}:`);
console.log(`    the worst 5% of careful owners end on ${rupiah(careful.lowCash)}, the average on ${rupiah(careful.meanCash)}.`);
