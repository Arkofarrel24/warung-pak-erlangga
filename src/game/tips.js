/**
 * Tips: the coins customers leave on the counter, and which of them the
 * player picked up.
 *
 * A jar belongs to one day. It is told about every customer who has been
 * served and decides, by the day's own random numbers, whether that customer
 * leaves a coin. A coin lies on the counter for a while (TIPS.shelfLife) and
 * is then gone; picked up in time, it counts toward the day's cash.
 *
 * Nothing here touches the simulation. The jar only reads the customers the
 * engine has finished with, and has a random stream of its own, so a day
 * with tips is the same day without them: the same arrivals, the same
 * waits, the same reputation.
 */

import { createRng, STREAM } from '../sim/rng.js';
import { TIPS } from './config.js';

/** A customer who was called to the counter the moment they arrived. */
export const servedAtOnce = (customer) => customer.serviceStart === customer.arrivalTime;

/**
 * @param {number} seed the game's seed
 * @param {number} day  the day being played
 */
export function createTipJar(seed, day) {
  const rng = createRng(seed, day, STREAM.TIPS);
  /** One draw per customer, by customer number: who is asked first does not matter. */
  const draws = [];
  const luck = (id) => {
    while (draws.length <= id) draws.push(rng());
    return draws[id];
  };

  /** @type {Map<number, { id: number, amount: number, leftAt: number, taken: boolean }>} */
  const coins = new Map();
  let taken = 0;

  /** Whether a coin is still lying on the counter at the given time. */
  function waiting(id, clock) {
    const coin = coins.get(id);
    return Boolean(coin) && !coin.taken && clock - coin.leftAt <= TIPS.shelfLife;
  }

  return {
    /**
     * A customer has been served and leaves. Returns the coin they left on
     * the counter, or null. Asking twice about the same customer gives the
     * same coin, not a second one.
     *
     * @param {{ id: number, arrivalTime: number, serviceStart: number }} customer
     * @param {number} clock the time they left, in hours since opening
     */
    leave(customer, clock) {
      if (coins.has(customer.id)) return coins.get(customer.id);
      if (!servedAtOnce(customer) || luck(customer.id) >= TIPS.chance) return null;
      const coin = { id: customer.id, amount: TIPS.amount, leftAt: clock, taken: false };
      coins.set(coin.id, coin);
      return coin;
    },

    waiting,

    /**
     * Picks a coin up. Returns what it was worth, or 0 when it had already
     * gone or been taken: a coin is only ever counted once.
     */
    take(id, clock) {
      if (!waiting(id, clock)) return 0;
      const coin = coins.get(id);
      coin.taken = true;
      taken += 1;
      return coin.amount;
    },

    /** How many coins were left today, and how many of them were picked up. */
    get left() {
      return coins.size;
    },
    get taken() {
      return taken;
    },
    /** The rupiah picked up. */
    get amount() {
      return taken * TIPS.amount;
    },
  };
}
