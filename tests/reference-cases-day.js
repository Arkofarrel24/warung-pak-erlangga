/**
 * The reference day for validating the engine against the transient solver.
 *
 * It is not the game's balance; those numbers are set in a later stage. It
 * is built to push every new feature at once. Times are in hours since
 * opening, rates per hour.
 *
 *   hour     0    3    5   6.5   8    10   11   12
 *   λ(t)     10   14   45  45    18   34   30   12     customers per hour
 *
 *   staff    2 from 0, 3 from 4.5, 2 from 7.5, 3 from 9.5, 1 from 11.5
 *
 * With μ = 15 per server, three servers handle 45 per hour: at the lunch
 * peak the offered load λ/(cμ) is exactly 1. The last half hour starts with
 * λ = 21 against a single server, an offered load of 1.4.
 *
 * Four waiting seats and a mean patience of 15 minutes make both ways of
 * losing a customer common: of about 315 arrivals a day, theory expects
 * about 13 to balk and 26 to renege.
 */
export const DAY_CASE = Object.freeze({
  arrivalProfile: [
    { time: 0, rate: 10 },
    { time: 3, rate: 14 },
    { time: 5, rate: 45 },
    { time: 6.5, rate: 45 },
    { time: 8, rate: 18 },
    { time: 10, rate: 34 },
    { time: 11, rate: 30 },
    { time: 12, rate: 12 },
  ],
  serviceRate: 15, //   μ: a server takes 4 minutes per customer on average
  staffSchedule: [
    { time: 0, servers: 2 },
    { time: 4.5, servers: 3 },
    { time: 7.5, servers: 2 },
    { time: 9.5, servers: 3 },
    { time: 11.5, servers: 1 },
  ],
  waitingRoom: 4, //    waiting seats; a customer who finds them all taken balks
  patienceRate: 4, //   θ: a waiting customer gives up after 15 minutes on average
  closingTime: 12,
  periodLength: 1,
});

export const DAY_RUN = Object.freeze({
  replications: 20_000,
  seed: 20_261_005,
});
