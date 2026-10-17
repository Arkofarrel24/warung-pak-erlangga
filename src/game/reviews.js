/**
 * What the day's customers would say: a few of them, chosen from the
 * customers the engine really simulated, with what really happened to them.
 *
 * The guest book watches the events of a day and keeps, for each way a
 * visit can end, the customer who shows it most plainly: the one served
 * after the longest wait, one served at once, the one who waited longest
 * before giving up, one turned away at a full warung, one who came after
 * the food ran out. Nothing is made up: a review is a customer's number,
 * the time they came, how long they waited, and how it ended. The words are
 * put to it by the interface.
 */

import { ARRIVAL_OUTCOME, EVENT } from '../sim/engine.js';

export const REVIEW = Object.freeze({
  SERVED_AT_ONCE: 'servedAtOnce',
  SERVED_AFTER_WAIT: 'servedAfterWait',
  RENEGED: 'reneged',
  FULL: 'full',
  SOLD_OUT: 'soldOut',
});

/** A customer's visit as a review: plain numbers that survive being saved. */
const entry = (kind, customer, wait) => ({ kind, customer: customer.id, arrivedAt: customer.arrivalTime, wait });

export function createGuestBook() {
  /** One candidate per kind. */
  const kept = {};
  const keepIf = (candidate, better) => {
    const held = kept[candidate.kind];
    if (!held || better(candidate, held)) kept[candidate.kind] = candidate;
  };
  const longer = (a, b) => a.wait > b.wait;
  const first = () => false;

  return {
    /** One event of the day, as the engine reports it. */
    note(record) {
      if (!record) return;
      if (record.type === EVENT.DEPARTURE) {
        const wait = record.customer.serviceStart - record.customer.arrivalTime;
        if (wait > 0) keepIf(entry(REVIEW.SERVED_AFTER_WAIT, record.customer, wait), longer);
        else keepIf(entry(REVIEW.SERVED_AT_ONCE, record.customer, 0), first);
      } else if (record.type === EVENT.RENEGE) {
        keepIf(entry(REVIEW.RENEGED, record.customer, record.time - record.customer.arrivalTime), longer);
      } else if (record.type === EVENT.ARRIVAL) {
        if (record.outcome === ARRIVAL_OUTCOME.REJECTED) keepIf(entry(REVIEW.FULL, record.customer, 0), first);
        else if (record.outcome === ARRIVAL_OUTCOME.SOLD_OUT) keepIf(entry(REVIEW.SOLD_OUT, record.customer, 0), first);
      } else if (record.type === EVENT.BATCH_ARRIVAL) {
        for (const arrival of record.arrivals) this.note({ type: EVENT.ARRIVAL, time: record.time, ...arrival });
      }
    },

    /**
     * Up to three reviews, the bad ones first: what went wrong is what the
     * owner most needs to hear, and one content customer rounds it off.
     */
    pick(limit = 3) {
      const order = [REVIEW.RENEGED, REVIEW.FULL, REVIEW.SOLD_OUT, REVIEW.SERVED_AFTER_WAIT, REVIEW.SERVED_AT_ONCE];
      const found = order.map((kind) => kept[kind]).filter(Boolean);
      // Always room for somebody who went home fed, when there was one.
      const fed = found.filter((review) => review.kind === REVIEW.SERVED_AFTER_WAIT || review.kind === REVIEW.SERVED_AT_ONCE);
      const unfed = found.filter((review) => !fed.includes(review));
      const chosen = [...unfed.slice(0, fed.length > 0 ? limit - 1 : limit), ...fed].slice(0, limit);
      return chosen;
    },
  };
}
