/**
 * The morning's draft: the decisions the player is still working on.
 *
 * Two screens edit the same draft, the morning itself and the shop next
 * door, so the pieces they share live here: where a draft comes from, what
 * follows from it by plain arithmetic, and how the shopping basket changes.
 * The draft is kept in the session, so it survives going from one screen to
 * the other and reloading the page.
 */

import { SHIFTS, UPGRADES } from '../game/config.js';
import {
  applyPurchases,
  patienceRate,
  purchaseCost,
  rentOn,
  serviceRate,
  staffPerShift,
  wagePerHour,
} from '../game/day.js';
import { eventForDay, ingredientCost, morningNews } from '../game/events.js';
import { defaultDecisions } from '../game/game.js';

const HOURS_PER_SHIFT = SHIFTS[0].to - SHIFTS[0].from;
const sum = (values) => values.reduce((total, value) => total + value, 0);

/** The piece of news the player knows this morning, or null. */
export function todaysNews(game) {
  return morningNews(eventForDay(game.seed, game.day));
}

/** The decisions to open the morning with: the saved draft for today, or yesterday's again. */
export function loadDraft({ game, session }) {
  const perPortion = ingredientCost(todaysNews(game));
  const fallback = defaultDecisions(game);
  // Yesterday's stock may cost more than today's cash can pay for.
  fallback.stock = Math.min(fallback.stock, Math.floor(game.cash / perPortion));

  const saved = session.draftDay === game.day ? session.draft : null;
  if (!saved || typeof saved !== 'object') return fallback;
  const number = (value, otherwise) => (Number.isFinite(value) ? value : otherwise);
  const isShifts = Array.isArray(saved.shifts) && saved.shifts.length === SHIFTS.length;
  return {
    staff: number(saved.staff, fallback.staff),
    shifts: isShifts ? saved.shifts.map((servers) => number(servers, fallback.staff)) : null,
    price: number(saved.price, fallback.price),
    stock: number(saved.stock, fallback.stock),
    seats: number(saved.seats, fallback.seats),
    buy: {
      seats: number(saved.buy?.seats, 0),
      training: Boolean(saved.buy?.training),
      upgrades: Array.isArray(saved.buy?.upgrades)
        ? saved.buy.upgrades.filter((id) => Object.hasOwn(UPGRADES, id) && !game.upgrades[id])
        : [],
    },
  };
}

export function saveDraft(store, draft) {
  store.remember({ draft, draftDay: store.game.day });
}

/** Everything that follows from the decisions by arithmetic alone. Nothing here is a forecast. */
export function draftFacts(game, draft) {
  const news = todaysNews(game);
  const perPortion = ingredientCost(news);
  const equipped = applyPurchases(game, draft.buy);
  const staff = staffPerShift(equipped, draft);
  const purchases = purchaseCost(game, draft.buy);
  const ingredients = perPortion * draft.stock;
  const staffHours = sum(staff) * HOURS_PER_SHIFT;
  const wages = wagePerHour(equipped) * staffHours;
  const margin = draft.price - perPortion;
  const rate = serviceRate(equipped);
  const rent = rentOn(game.day);
  return {
    news,
    perPortion,
    equipped,
    staff,
    staffHours,
    purchases,
    ingredients,
    morningCost: purchases + ingredients,
    cashLeft: game.cash - purchases - ingredients,
    wages,
    rent,
    margin,
    // Break-even point: the customers needed to cover wages and rent.
    breakEven: margin > 0 ? (wages + rent) / margin : Infinity,
    serviceRate: rate,
    // Capacity c·μ: the most customers the pegawai can serve in an hour.
    capacity: staff.map((servers) => servers * rate),
    patienceMinutes: 60 / patienceRate(equipped),
    affordableStock: Math.max(0, Math.floor((game.cash - purchases) / perPortion)),
    hoursPerShift: HOURS_PER_SHIFT,
  };
}

/** How many things are in the basket. */
export function basketCount(draft) {
  return draft.buy.seats + (draft.buy.training ? 1 : 0) + draft.buy.upgrades.length;
}

/**
 * Changes the number of stools being bought. New stools are put out straight
 * away; stools taken back off the basket are taken back in.
 */
export function setSeatsBought(game, draft, count) {
  const owned = game.seatsOwned + count;
  draft.seats = Math.max(0, Math.min(draft.seats + (count - draft.buy.seats), owned));
  draft.buy.seats = count;
}

/** Puts an upgrade in the basket, or takes it out again. */
export function toggleUpgrade(draft, id) {
  const inBasket = draft.buy.upgrades.includes(id);
  draft.buy.upgrades = inBasket
    ? draft.buy.upgrades.filter((other) => other !== id)
    : [...draft.buy.upgrades, id];
  // Without the board there is no schedule to keep.
  if (id === 'shiftBoard' && inBasket) draft.shifts = null;
}
