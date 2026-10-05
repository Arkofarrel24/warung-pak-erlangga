/**
 * A time-varying arrival rate λ(t).
 *
 * A warung is quiet in the morning, crowded at lunch, and busy again in the
 * evening, so one constant λ cannot describe a day. Arrivals whose rate
 * changes over time form a non-homogeneous Poisson process (NHPP): in a short
 * interval (t, t + dt) a customer arrives with probability λ(t)·dt, and the
 * number of arrivals in any interval (a, b) is Poisson distributed with mean
 *
 *   Λ(a, b) = ∫ λ(t) dt  from a to b
 *
 * The rate is stored as a list of points (time, rate) joined by straight
 * lines, that is, a piecewise-linear function. Before the first point and
 * after the last one the rate stays flat. Two points at the same time make a
 * jump. Keeping it as plain data, not a function, means it can be sent to a
 * Web Worker and saved in localStorage.
 */
export class ArrivalProfile {
  #times;
  #rates;
  #maxRate;

  /** @param {{ time: number, rate: number }[]} points in order of time */
  constructor(points) {
    if (!Array.isArray(points) || points.length === 0) {
      throw new RangeError('Arrival profile must be a non-empty list of { time, rate } points.');
    }
    points.forEach(({ time, rate }, i) => {
      if (!Number.isFinite(time) || !Number.isFinite(rate) || rate < 0) {
        throw new RangeError('Arrival profile points need a finite time and a rate of at least 0.');
      }
      if (i > 0 && time < points[i - 1].time) {
        throw new RangeError('Arrival profile points must be in order of time.');
      }
    });

    this.#times = points.map((point) => point.time);
    this.#rates = points.map((point) => point.rate);
    this.#maxRate = Math.max(...this.#rates);
    if (!(this.#maxRate > 0)) {
      throw new RangeError('Arrival profile must have a positive rate somewhere.');
    }
  }

  /**
   * The largest rate anywhere on the profile. A piecewise-linear function
   * reaches its maximum at one of its points, so this is exact. The thinning
   * algorithm uses it as its upper bound λ_max.
   */
  get maxRate() {
    return this.#maxRate;
  }

  /** The times at which the slope of λ(t) changes. */
  get breakpoints() {
    return [...this.#times];
  }

  /** λ(t). At a jump this is the value just after it. */
  rateAt(time) {
    const times = this.#times;
    // The last point at or before `time`.
    let i = -1;
    while (i + 1 < times.length && times[i + 1] <= time) i++;
    if (i === -1) return this.#rates[0];
    if (i === times.length - 1) return this.#rates[i];
    return this.#interpolate(i, time);
  }

  /** λ just before `time`. It differs from rateAt() only at a jump. */
  rateBefore(time) {
    const times = this.#times;
    // The first point at or after `time`.
    let j = 0;
    while (j < times.length && times[j] < time) j++;
    if (j === 0) return this.#rates[0];
    if (j === times.length) return this.#rates[j - 1];
    return this.#interpolate(j - 1, time);
  }

  /**
   * Λ(from, to): the expected number of arrivals between two times.
   *
   * Between two neighboring points λ(t) is a straight line, so the area under
   * it is a trapezoid and the result is exact, not a numerical approximation.
   */
  expectedArrivals(from, to) {
    if (!(to > from)) return 0;
    const cuts = [from, ...this.#times.filter((time) => time > from && time < to), to];
    let area = 0;
    for (let k = 1; k < cuts.length; k++) {
      const a = cuts[k - 1];
      const b = cuts[k];
      area += ((this.rateAt(a) + this.rateBefore(b)) / 2) * (b - a);
    }
    return area;
  }

  /** The straight line between point i and point i + 1, evaluated at `time`. */
  #interpolate(i, time) {
    const t0 = this.#times[i];
    const t1 = this.#times[i + 1];
    const r0 = this.#rates[i];
    const r1 = this.#rates[i + 1];
    return r0 + ((r1 - r0) * (time - t0)) / (t1 - t0);
  }
}
