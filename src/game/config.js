/**
 * Every number the game runs on, in one place.
 *
 * The numbers come in two kinds, and it matters which is which:
 *
 * - MODEL numbers describe the warung itself: opening hours, how the day's
 *   crowd rises and falls, how fast one person serves. They are chosen to
 *   look like a small warung and are not tuned for difficulty.
 *
 * - BALANCE numbers (wage, rent, starting cash, prices of upgrades) are
 *   derived from the model numbers by a stated rule, not picked by feel.
 *   Each one below carries its rule. `npm run balance` recomputes all of
 *   them from the model and prints the working, and tests/balance.test.js
 *   fails if a number drifts away from its rule.
 *
 * Money is in rupiah, time in hours since opening, rates per hour.
 */

// ---------------------------------------------------------------------------
// MODEL
// ---------------------------------------------------------------------------

export const DAY = Object.freeze({
  openHour: 8, // the warung opens at 08:00
  hours: 12, //   and closes at 20:00
  periodLength: 1, // statistics are kept per hour
  count: 14, // a game lasts two weeks
});

export const DEMAND = Object.freeze({
  /**
   * Arrival rate at each full hour (08:00, 09:00, ..., 20:00), in customers
   * per hour, at the starting price and a reputation of 50. Between the
   * hours the rate moves in a straight line. Quiet morning, lunch peak at
   * noon, a lull, and a second peak around 18:00. About 205 customers a day.
   */
  baseProfile: Object.freeze([6, 8, 10, 18, 32, 30, 14, 8, 10, 20, 28, 20, 8]),

  /** The price at which the base profile applies. */
  referencePrice: 10_000,

  /**
   * Price sensitivity s of an exponential (log-linear) demand curve:
   *
   *   demand factor = e^(-(price - reference price) / s)
   *
   * Every Rp 1,000 added to the price turns away about 18% of customers.
   * This curve has a simple optimum: with unlimited capacity, margin times
   * demand, (p - v)·e^(-(p - p0)/s), is largest at p = v + s. When the
   * warung is congested the best price is higher still, because customers
   * lost to a higher price were going to be lost to the queue anyway.
   *
   * A model number, chosen so that the price is one decision among several
   * and not the whole game: with s = 5,000 the best price without a queue
   * is Rp 11,000, one step above the starting price, and a price far above
   * it empties the warung faster than the margin grows. (At 7,000, which
   * this game first used, Rp 15,000 alone won three stars in 94 games of
   * 100; see section 13 of `npm run balance`.)
   */
  priceSensitivity: 5_000,

  /**
   * Reputation (0 to 100) scales the whole profile in a straight line:
   * factor = floor + slope·R/100. At R = 50 the factor is exactly 1.
   */
  reputationFloor: 0.4,
  reputationSlope: 1.2,
});

export const SERVICE = Object.freeze({
  /** μ: one untrained pegawai serves 12 customers an hour, 5 minutes each. */
  baseRate: 12,
  /** θ: a waiting customer gives up at rate 5 per hour, after 12 minutes on average. */
  basePatienceRate: 5,
});

/** Four shifts of three hours, used once the shift board has been bought. */
export const SHIFTS = Object.freeze([
  Object.freeze({ id: 'pagi', from: 0, to: 3 }), //   08:00-11:00
  Object.freeze({ id: 'siang', from: 3, to: 6 }), //  11:00-14:00
  Object.freeze({ id: 'sore', from: 6, to: 9 }), //   14:00-17:00
  Object.freeze({ id: 'petang', from: 9, to: 12 }), // 17:00-20:00
]);

export const LIMITS = Object.freeze({
  staff: Object.freeze({ min: 1, max: 6 }),
  price: Object.freeze({ min: 5_000, max: 25_000, step: 500 }),
  stock: Object.freeze({ min: 0, max: 600 }),
  seats: Object.freeze({ min: 0, max: 12 }),
});

/**
 * Reputation: how each customer's visit turns into the day's score, and how
 * fast the score moves the reputation.
 *
 * Day score = 100 x (points earned / customers who came), kept within 0-100:
 *
 *   + 1                    for each customer served
 *   - 1 / waitTolerance    for each hour anyone spent waiting. With a
 *                          tolerance of 20 minutes, twenty minutes of
 *                          waiting cancel one satisfied customer. The total
 *                          waiting time is the area under the queue-length
 *                          curve, Lq x T: the link from Lq to reputation.
 *   - renegePenalty        for each customer who gave up waiting (reneging)
 *   - turnedAwayPenalty    for each customer who found the place full
 *                          (balking) or sold out
 *
 * The reputation then moves part of the way toward the day's score:
 *
 *   R_next = R + memory x (score - R)
 *
 * which is exponential smoothing. With memory = 0.3, a day counts for 30%
 * and everything before it for 70%, so one bad day hurts but does not ruin.
 */
export const REPUTATION = Object.freeze({
  start: 50,
  memory: 0.3,
  waitTolerance: 20 / 60,
  renegePenalty: 1,
  turnedAwayPenalty: 0.5,
});

// ---------------------------------------------------------------------------
// BALANCE
//
// The working behind each number is printed by `npm run balance`. The figures
// quoted in the comments are expected values from the analytic solver for the
// starting setup: 2 pegawai, Rp 10,000, 2 waiting seats, reputation 50.
// ---------------------------------------------------------------------------

export const COSTS = Object.freeze({
  /** v: ingredients for one portion. A model number; the rest follow from it. */
  ingredient: 6_000,

  /**
   * Wage per pegawai per hour.
   *
   * Rule: at the starting setup a third pegawai should just pay for itself
   * on the day, so that hiring is a real decision and not an obvious one.
   *
   * Working: 2 pegawai serve 162.5 customers a day and 3 serve 188.3, a gain
   * of 25.8. At a margin of Rp 4,000 each that is Rp 103,300 a day, or
   * Rp 8,600 an hour over a 12-hour day. What the third pegawai does buy is
   * reputation: the day score rises from 59 to 84.
   */
  wagePerHour: 8_500,

  /**
   * Rent per day.
   *
   * Rule: the starting setup should keep about 5% of its sales income as
   * profit. Doing nothing gets you nowhere: it neither sinks the warung nor
   * makes it prosper, so every decision shows up in the result.
   *
   * Working: with the stock a newsvendor would prepare (160 portions), sales
   * less ingredients come to Rp 608,300 a day. Fixed costs may be 95% of
   * that, Rp 577,900. Two pegawai cost Rp 204,000, leaving Rp 373,900.
   * Break-even point: (375,000 + 204,000) / 4,000 = 145 customers a day,
   * against 162 expected.
   */
  rent: 375_000,
});

/**
 * The rent goes up once, at the start of the second week.
 *
 * Rule: a warung that is still run as on its first day should start losing
 * money in the second week, so that standing still stops being safe. The
 * rise is one and a half times what the starting setup is expected to earn
 * on an ordinary day, rounded to Rp 25,000.
 *
 * Working: the starting setup is expected to earn Rp 70,000 a day, and
 * 1.5 x 70,000 = 105,000, which rounds to Rp 100,000. From day 8 the same
 * setup loses about Rp 30,000 a day. Over 300 games a player who never
 * changes anything then ends on Rp 1.1 million, busier second week included,
 * and goes under in 7% of them, while a careful owner still ends above
 * Rp 6 million.
 *
 * The rise is announced on the first morning. A rise that is known is a
 * reason to plan; one that is not would only be a trap.
 */
export const RENT_RISE = Object.freeze({ fromDay: 8, amount: 100_000 });

/**
 * From the second week the warung is known: more customers come at every
 * hour of the day, on the same day the rent goes up. λ(t) is multiplied by
 * `demandFactor` and nothing else changes, so the queue is the same model
 * with a busier street.
 *
 * Rule: a warung that is run well should meet its queue again. A careful
 * owner (3 pegawai, Rp 13,000) has by then raised the price and the
 * reputation until the lunch peak sits well under what the pegawai can
 * serve. The factor is what brings that peak back to capacity, traffic
 * intensity a = λ ÷ (c·μ) = 1, rounded to one decimal.
 *
 * Working: see `growthByRule` in scripts/derive.js and section 13 of
 * `npm run balance`.
 */
export const GROWTH = Object.freeze({ fromDay: 8, demandFactor: 1.4 });

/**
 * Stars at the end of a game: the cash it takes for two and for three.
 *
 * Surviving the fourteen days earns one star whatever the cash. The other
 * two reward a warung that did more than survive.
 *
 * Rule: two stars for doubling the starting cash, which standing still or
 * only following the news never does; three stars sit just below the worst
 * games of a careful owner (a third pegawai, a higher price, and stock to
 * match), so sound decisions earn them whatever the luck of the events.
 * Working: the best 5% of players who never change anything end near
 * Rp 1.75 million, far below 2 x 1,500,000 = Rp 3,000,000. The worst 5% of
 * careful owners end near Rp 5.5 million, above Rp 5,000,000.
 */
export const STARS = Object.freeze({ two: 3_000_000, three: 5_000_000 });

export const START = Object.freeze({
  /**
   * Rule: enough to open on the first day and survive it even if not one
   * customer came: the first morning's ingredients, a day of wages, and a
   * day of rent.
   * Working: 960,000 + 204,000 + 375,000 = 1,539,000, rounded to a figure
   * that is easy to keep in mind.
   *
   * Ingredients are paid every morning out of cash. A player whose cash
   * falls below the cost of a day's stock must prepare less, sells less, and
   * falls further behind: that squeeze is how a warung goes under.
   */
  cash: 1_500_000,

  /**
   * A model number, low on purpose. The third and fourth seat are worth
   * buying; from the fifth on a seat brings nothing, because a customer that
   * far back in the line is more likely to give up than to be served.
   */
  seats: 2,
  staff: 2,
  price: 10_000,

  /**
   * Portions prepared on the first day.
   *
   * Rule: the newsvendor quantile. A portion too few loses its margin of
   * Rp 4,000, a portion too many loses its cost of Rp 6,000, so the best
   * stock is the 4,000 / (4,000 + 6,000) = 40% quantile of demand.
   * Working: over 4,000 simulated days that quantile is 160 portions.
   */
  stock: 160,
});

/**
 * Tips: a customer who is served the moment they walk in, without having to
 * sit down and wait, sometimes leaves a coin on the counter. The player picks
 * it up while watching the day, before it is gone.
 *
 * Tips are outside the queueing model. They change who is served, how long
 * anyone waits, and the reputation by nothing at all; they only add a little
 * to the cash. What they do depend on is the model's own probability of not
 * having to wait: a warung with enough pegawai for its crowd sees more
 * customers served at once, and so more coins.
 *
 * `amount` and `shelfLife` are model numbers: the coin a customer leaves
 * behind from their change, and 40 minutes on the counter, which is four
 * seconds of watching at normal speed.
 *
 * Rule for `chance`: picking up every coin of a day at the starting setup
 * should be worth about a quarter of what that day is expected to earn.
 * Enough to be worth the attention, far too little to live on. The chance
 * is rounded to the nearest 5%.
 *
 * Working: 96.9 customers a day are served without waiting, and a quarter of
 * the expected profit of Rp 70,000 is Rp 17,500, which is 17.5 coins:
 * 17.5 / 96.9 = 18%, rounded to one customer in five. Over 300 games a
 * player who never changes anything and never misses a coin gains
 * Rp 280,000, and the best 5% of them still end near Rp 2.0 million, far
 * below two stars; one pegawai or a price near cost still goes under every
 * time. A careful owner gains Rp 370,000 on top of more than Rp 6 million.
 */
export const TIPS = Object.freeze({ amount: 1_000, shelfLife: 40 / 60, chance: 0.2 });

/**
 * The day's challenge: one small goal a day, read off the day's own report.
 * Meeting it earns a stamp on the calendar and a little cash.
 *
 * Rule for the thresholds: each is the median day of a careful owner
 * (3 pegawai, Rp 13,000, stock to match), so that a warung run well meets
 * its challenge about every other day and one run badly hardly ever does.
 *
 *   servedShare  customers served, as a share of those who came (to 5%)
 *   reneged      customers who gave up waiting
 *   lost         customers lost in any way: gave up, found it full, or sold out
 *   stockMiss    portions left over plus customers who found nothing left:
 *                how far the stock was from the day's demand, either way
 *
 * Rule for the reward: all fourteen stamps together are worth one ordinary
 * day's expected profit at the starting setup, so the cash stays the score.
 * Working: Rp 70,000 / 14 = Rp 5,000.
 */
export const CHALLENGES = Object.freeze({ reward: 5_000, servedShare: 0.9, reneged: 5, lost: 17, stockMiss: 10 });

/**
 * One-time purchases. Each changes exactly one parameter of the queue, so
 * that buying it teaches what that parameter does.
 *
 * Rule for every price below: half of what the purchase adds to the profit
 * of the whole game when it is bought on day 1 by a warung run on its
 * starting setup. So it pays for itself in about a week, and buying it in
 * the last week loses money.
 */
export const UPGRADES = Object.freeze({
  /** A faster cash register: μ x 1.2. Brings Rp 1,313,000; half is Rp 656,000. */
  cashRegister: Object.freeze({ cost: 650_000, serviceFactor: 1.2 }),
  /**
   * Queue numbers: customers take a number and need not stand in line, so
   * they wait longer before giving up. Mean patience x 1.5, that is θ / 1.5.
   * Brings Rp 186,000; half is Rp 93,000.
   */
  queueNumbers: Object.freeze({ cost: 90_000, patienceFactor: 1.5 }),
  /**
   * A shift board: pegawai can be scheduled per shift instead of per day.
   * Valued differently, since it changes nothing until the schedule does:
   * the best schedule against the best fixed number of pegawai.
   * Brings Rp 1,031,000; half is Rp 515,000: in the busier second week the
   * best schedule (3, 6, 3, 5) is far from any fixed number of pegawai.
   */
  shiftBoard: Object.freeze({ cost: 525_000 }),
});

/**
 * Training raises μ for the whole team, and trained pegawai ask for more pay.
 * It is team-wide on purpose: with servers of different speeds the system
 * would no longer be M/M/c, and the formulas would not apply.
 *
 * Each level brings less than the one before (Rp 772,000, then Rp 670,000,
 * then Rp 579,000), so by the same rule each costs less: diminishing returns.
 */
export const TRAINING = Object.freeze([
  Object.freeze({ serviceFactor: 1, wageFactor: 1, cost: 0 }),
  Object.freeze({ serviceFactor: 1.15, wageFactor: 1.08, cost: 375_000 }),
  Object.freeze({ serviceFactor: 1.3, wageFactor: 1.16, cost: 325_000 }),
  Object.freeze({ serviceFactor: 1.45, wageFactor: 1.24, cost: 300_000 }),
]);

/**
 * One more waiting seat (K grows by one). Priced by the same rule on the
 * first extra seat, which brings Rp 163,000; half is Rp 82,000. The second
 * extra seat brings only Rp 33,000, and the ones after that nothing.
 */
export const SEAT_COST = 80_000;

// ---------------------------------------------------------------------------
// EVENTS
// ---------------------------------------------------------------------------

/**
 * Days on which something unexpected happens.
 *
 * There are two kinds. "News" is known in the morning, before the player
 * decides, so it can be planned for. A "surprise" happens once the warung
 * is open, and tests how much slack the day's plan has.
 *
 * Each event changes one input of the queueing model and nothing else, so
 * that its effect in the report can be traced to it:
 *
 *   costFactor    ingredient cost per portion, for the day
 *   demandFactor  arrival rate λ(t): all day, from hour `from` on, or (for a
 *                 surprise) from the moment it strikes
 *   staffChange   pegawai added to or taken from the counter, c(t): all day,
 *                 or for `duration` hours from the moment the event strikes
 *   size          customers who arrive at once, a bulk arrival
 *
 * `wagesUnchanged` marks a change at the counter that the wage bill does not
 * follow: a pegawai sent on an errand is still paid, a nephew who lends a
 * hand is not. (A pegawai who is sick all day is not paid.)
 *
 * A warung never drops below one pegawai: the owner steps in.
 *
 * Rule: good and bad events should roughly cancel, so that events add
 * variety without making the average day better or worse. Working: see
 * section 9 of `npm run balance`.
 */
export const EVENTS = Object.freeze({
  /** The first day is always calm. */
  firstDay: 2,
  /** The chance that a day from then on brings an event: about two days in five. */
  chance: 0.4,
  catalog: Object.freeze({
    ingredientsUp: Object.freeze({ kind: 'news', costFactor: 1.2 }),
    ingredientsDown: Object.freeze({ kind: 'news', costFactor: 0.8 }),
    rain: Object.freeze({ kind: 'news', demandFactor: 0.75 }),
    payday: Object.freeze({ kind: 'news', demandFactor: 1.25 }),
    nightMarket: Object.freeze({ kind: 'news', demandFactor: 1.6, from: 9 }),
    staffSick: Object.freeze({ kind: 'surprise', staffChange: -1 }),
    tourGroup: Object.freeze({ kind: 'surprise', size: 14, earliest: 2, latest: 10 }),
    // The gas runs out, and one pegawai goes to swap the canister.
    gasOut: Object.freeze({ kind: 'surprise', staffChange: -1, duration: 1.5, earliest: 2, latest: 9, wagesUnchanged: true }),
    // Someone posts a video of the warung, and people start coming.
    viral: Object.freeze({ kind: 'surprise', demandFactor: 1.5, earliest: 3, latest: 8 }),
    // Pak Erlangga's nephew drops by and serves for a few hours, unpaid.
    helper: Object.freeze({ kind: 'surprise', staffChange: 1, duration: 3, earliest: 2, latest: 8, wagesUnchanged: true }),
  }),
});
