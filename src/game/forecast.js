/**
 * What a day is expected to bring, computed instead of simulated.
 *
 * The simulation plays out one possible day. This module asks the analytic
 * solver for the average over all possible days with the same decisions. It
 * is what the balance of the game is derived from, and what the simulated
 * days are checked against.
 */

import { solveDay } from '../analytic/transient.js';
import { applyPurchases, dayModel, paidStaffTime, rentOn, wagePerHour } from './day.js';
import { ingredientCost } from './events.js';
import { dayScore } from './reputation.js';

/**
 * @param {object | null} [event] the day's event, as from eventForDay()
 * @returns expected values for the day, assuming the stock never runs out
 */
export function expectedDay(state, decisions, event = null) {
  const equipped = applyPurchases(state, decisions.buy);
  const model = dayModel(equipped, decisions, event);
  const theory = solveDay(model);

  // "Demand" in the stock decision: the portions the day would sell if the
  // kitchen never ran out. Sales are then min(demand, stock).
  const demand = theory.served;
  const margin = decisions.price - ingredientCost(event);
  const wages = wagePerHour(equipped) * paidStaffTime(equipped, decisions, theory.totalStaffedTime, event);
  const rent = rentOn(state.day);
  const fixedCosts = wages + rent;

  return {
    model,
    theory,
    arrivals: theory.arrivals,
    demand,
    reneged: theory.reneged,
    rejected: theory.rejected,
    // The score of the average day. The average of the score is slightly
    // different, because the score is a ratio; the difference is small.
    score: dayScore({ ...theory, soldOut: 0 }),
    // Contribution: what the day's sales add after paying for their ingredients.
    contribution: margin * demand,
    wages,
    rent,
    // Profit when exactly as many portions are prepared as are sold.
    profit: margin * demand - fixedCosts,
    // Break-even point: the customers needed to cover wages and rent.
    breakEvenCustomers: fixedCosts / margin,
    // Margin of safety: how far sales can fall before the day makes a loss.
    marginOfSafety: 1 - fixedCosts / (margin * demand),
  };
}
