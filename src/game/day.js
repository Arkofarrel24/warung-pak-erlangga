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
 */

import { COSTS, DAY, SEAT_COST, SERVICE, SHIFTS, TRAINING, UPGRADES } from './config.js';
import { arrivalProfile } from './demand.js';

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
 * purchases.
 */
export function dayModel(state, decisions) {
  const model = {
    arrivalProfile: arrivalProfile({ price: decisions.price, reputation: state.reputation }),
    serviceRate: serviceRate(state),
    waitingRoom: decisions.seats,
    patienceRate: patienceRate(state),
    closingTime: DAY.hours,
    periodLength: DAY.periodLength,
  };

  const staff = staffPerShift(state, decisions);
  if (staff.every((servers) => servers === staff[0])) {
    model.servers = staff[0];
  } else {
    // c(t): one entry per shift whose number differs from the shift before.
    model.staffSchedule = SHIFTS.map((shift, i) => ({ time: shift.from, servers: staff[i] })).filter(
      (entry, i) => i === 0 || entry.servers !== staff[i - 1],
    );
  }
  return model;
}

/**
 * The day's accounts.
 *
 *   revenue      price x customers served
 *   ingredients  cost per portion x portions prepared; what is not sold is
 *                thrown away, so it is the stock that is paid for, not the sales
 *   wages        hourly wage x hours the pegawai were at their post, the
 *                few minutes of overtime after closing included
 *   rent         a fixed amount per day
 *
 * Purchases (seats, training, upgrades) are investments and are kept out of
 * the day's profit, but they do come out of the cash.
 */
export function settle(stateBefore, state, decisions, results) {
  const revenue = decisions.price * results.served;
  const ingredients = COSTS.ingredient * decisions.stock;
  const wages = Math.round(wagePerHour(state) * results.totalStaffedTime);
  const rent = COSTS.rent;
  const purchases = purchaseCost(stateBefore, decisions.buy);
  const profit = revenue - ingredients - wages - rent;
  return {
    revenue,
    ingredients,
    // Portions thrown away at closing, at cost.
    waste: COSTS.ingredient * results.stockLeft,
    wages,
    rent,
    profit,
    purchases,
    cashBefore: stateBefore.cash,
    cashAfter: stateBefore.cash - purchases + profit,
  };
}
