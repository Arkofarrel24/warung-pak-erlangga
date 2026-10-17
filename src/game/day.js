/**
 * One day at the warung: from the player's decisions to a queueing model,
 * and from the simulated day to the day's accounts.
 *
 * This is where the game meets queueing theory. Each decision becomes one
 * parameter of an M(t)/M/c(t)/K+M queue:
 *
 *   price, reputation   ->  λ(t)   arrival rate
 *   pegawai, shifts     ->  c(t)   number of servers
 *   training, register  ->  μ      service rate of one server
 *   waiting seats       ->  K - c  waiting room
 *   queue numbers       ->  θ      rate at which waiting customers give up
 *   stock               ->         portions that can be sold
 *
 * The day's event, if there is one, changes one of the same parameters.
 */

import { COSTS, DAY, RENT_RISE, SEAT_COST, SERVICE, SHIFTS, TRAINING, UPGRADES } from './config.js';
import { arrivalProfile } from './demand.js';
import { eventArrivalProfile, eventBatchArrivals, eventStaffSchedule, hoursOffPayroll, ingredientCost } from './events.js';

/** μ: the base rate, raised by training and by the cash register. */
export function serviceRate(state) {
  const training = TRAINING[state.trainingLevel].serviceFactor;
  const register = state.upgrades.cashRegister ? UPGRADES.cashRegister.serviceFactor : 1;
  return SERVICE.baseRate * training * register;
}

/** θ: with queue numbers customers are more patient, so θ is smaller. */
export function patienceRate(state) {
  const patience = state.upgrades.queueNumbers ? UPGRADES.queueNumbers.patienceFactor : 1;
  return SERVICE.basePatienceRate / patience;
}

export function wagePerHour(state) {
  return COSTS.wagePerHour * TRAINING[state.trainingLevel].wageFactor;
}

/** The rent of a day: it goes up once, at the start of the second week. */
export function rentOn(day) {
  return COSTS.rent + (day >= RENT_RISE.fromDay ? RENT_RISE.amount : 0);
}

/** What the morning's purchases cost, before anything is bought. */
export function purchaseCost(state, buy = {}) {
  let cost = (buy.seats ?? 0) * SEAT_COST;
  if (buy.training) cost += TRAINING[state.trainingLevel + 1]?.cost ?? 0;
  for (const id of buy.upgrades ?? []) cost += UPGRADES[id]?.cost ?? 0;
  return cost;
}

/** The warung after the morning's purchases; the state passed in is not changed. */
export function applyPurchases(state, buy = {}) {
  const upgrades = { ...state.upgrades };
  for (const id of buy.upgrades ?? []) upgrades[id] = true;
  return {
    ...state,
    cash: state.cash - purchaseCost(state, buy),
    seatsOwned: state.seatsOwned + (buy.seats ?? 0),
    trainingLevel: state.trainingLevel + (buy.training ? 1 : 0),
    upgrades,
  };
}

/** The number of pegawai on duty in each of the four shifts. */
export function staffPerShift(state, decisions) {
  if (state.upgrades.shiftBoard && decisions.shifts) return [...decisions.shifts];
  return SHIFTS.map(() => decisions.staff);
}

/**
 * The queueing model of the day, in the form both the simulation engine and
 * the analytic solver take. `state` is the warung after the morning's
 * purchases, and `event` is what the day brings unasked, if anything.
 */
export function dayModel(state, decisions, event = null) {
  const model = {
    arrivalProfile: eventArrivalProfile(
      arrivalProfile({ price: decisions.price, reputation: state.reputation, day: state.day }),
      event,
    ),
    serviceRate: serviceRate(state),
    waitingRoom: decisions.seats,
    patienceRate: patienceRate(state),
    closingTime: DAY.hours,
    periodLength: DAY.periodLength,
  };

  // c(t): one entry per change in the number of pegawai. A number that
  // stays the same all day is not a schedule at all.
  const schedule = eventStaffSchedule(staffPerShift(state, decisions), event);
  if (schedule.length === 1) model.servers = schedule[0].servers;
  else model.staffSchedule = schedule;

  const batches = eventBatchArrivals(event);
  if (batches.length > 0) model.batchArrivals = batches;
  return model;
}

/**
 * The day's accounts.
 *
 *   revenue      price x customers served
 *   ingredients  cost per portion x portions prepared; what is not sold is
 *                thrown away, so it is the stock that is paid for, not the sales
 *   wages        hourly wage x hours the pegawai were at their post, the
 *                few minutes of overtime after closing included; an event
 *                may put someone at the counter unpaid, or keep a pegawai
 *                on the payroll while away from it (see paidStaffTime)
 *   rent         a fixed amount per day, higher from the second week on
 *   tips         the coins picked up from the counter during the day; income
 *                like the sales, but not from the queue (see tips.js)
 *
 * Purchases (seats, training, upgrades) are investments and are kept out of
 * the day's profit, but they do come out of the cash.
 */
/**
 * The pegawai-hours that are paid for, from the hours the counter was staffed.
 * `state` is the warung after the morning's purchases.
 */
export function paidStaffTime(state, decisions, totalStaffedTime, event = null) {
  return totalStaffedTime - hoursOffPayroll(staffPerShift(state, decisions), event);
}

export function settle(stateBefore, state, decisions, results, event = null, tips = 0) {
  const perPortion = ingredientCost(event);
  const revenue = decisions.price * results.served;
  const ingredients = perPortion * decisions.stock;
  const paidHours = paidStaffTime(state, decisions, results.totalStaffedTime, event);
  const wages = Math.round(wagePerHour(state) * paidHours);
  const rent = rentOn(stateBefore.day);
  const purchases = purchaseCost(stateBefore, decisions.buy);
  const profit = revenue + tips - ingredients - wages - rent;
  return {
    revenue,
    tips,
    ingredients,
    // Portions thrown away at closing, at cost.
    waste: perPortion * results.stockLeft,
    wages,
    paidHours,
    rent,
    profit,
    purchases,
    cashBefore: stateBefore.cash,
    cashAfter: stateBefore.cash - purchases + profit,
  };
}
