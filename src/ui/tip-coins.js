/**
 * The coins customers leave on the counter, as things to press.
 *
 * The scene is a canvas, and a canvas cannot be reached with a keyboard or
 * read out. So each coin is a real button laid over the canvas, exactly
 * where the scene draws the counter top: it can be tapped, tabbed to, and
 * named. Which customers leave a coin, how long it lies there, and whether a
 * press still counts are the tip jar's business (src/game/tips.js); this
 * module only shows the jar's coins and passes the presses on.
 *
 * A coin's ring runs out with the day's own clock, so it runs out faster
 * when the day is played faster and stands still when the day is paused.
 * While the day is paused the coins cannot be picked up either: stopping the
 * clock is for reading, not for emptying the counter at leisure.
 */

import { TIPS } from '../game/config.js';
import { h, svg } from './dom.js';
import { rupiah } from './format.js';
import { refuse } from './motion.js';

/** The ring is drawn inside the button, a little outside the coin. */
const RING_RADIUS = 19;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
/** From here on the ring is red: the same share at which a patience bar turns red. */
const LOW = 0.25;
/** A second coin at the same booth lies this much higher, as coins in a small pile do. */
const PILE_STEP = 13;
/** How long a coin that was not picked up takes to go, in milliseconds (see .tip--gone). */
const GONE_MS = 160;

/**
 * @param {object} options
 * @param {HTMLElement} options.layer what the coins are put in: laid exactly over the canvas
 * @param {ReturnType<import('../game/tips.js').createTipJar>} options.jar
 * @param {import('./warung-scene.js').WarungScene} options.scene
 * @param {() => number} options.clock the time the day shows, in hours since opening
 * @param {(amount: number, from: DOMRect) => void} [options.onTake] a coin was picked up from `from`
 * @param {() => void} [options.onMiss] a coin went before it was picked up
 */
export function createTipCoins({ layer, jar, scene, clock, onTake, onMiss }) {
  /** The coins lying on the counter now, by the number of the customer who left them. */
  const lying = new Map();
  let frozen = false;

  function button(amount) {
    const ring = svg('circle', { class: 'tip__ring', cx: 22, cy: 22, r: RING_RADIUS, 'stroke-dasharray': RING_LENGTH.toFixed(2) });
    const element = h('button', { type: 'button', class: 'tip', 'aria-label': `Pungut tip ${rupiah(amount)}` }, [
      svg('svg', { class: 'tip__timer', viewBox: '0 0 44 44', 'aria-hidden': 'true', focusable: 'false' }, [
        svg('circle', { class: 'tip__track', cx: 22, cy: 22, r: RING_RADIUS }),
        ring,
      ]),
      h('span', { class: 'tip__coin', 'aria-hidden': 'true', text: 'Rp' }),
    ]);
    return { element, ring };
  }

  function place(entry) {
    const spot = scene.counterSpot(entry.serverIndex);
    if (!spot) return;
    // Left and top, not a transform: the transform is the coin's own, for arriving and being pressed.
    entry.element.style.left = `${Math.round(spot.x + entry.lean)}px`;
    entry.element.style.top = `${Math.round(spot.y - entry.level * PILE_STEP)}px`;
  }

  function showLeft(entry, left) {
    entry.ring.style.strokeDashoffset = (RING_LENGTH * (1 - left)).toFixed(1);
    const low = left < LOW;
    if (low === entry.low) return;
    entry.low = low;
    entry.element.classList.toggle('tip--low', low);
  }

  function put(serverIndex, amount) {
    // The lowest place in the pile at this booth that no coin is lying in.
    const taken = new Set([...lying.values()].filter((other) => other.serverIndex === serverIndex).map((other) => other.level));
    let level = 0;
    while (taken.has(level)) level++;
    const entry = { ...button(amount), serverIndex, level, lean: 0, low: false };
    place(entry);
    layer.append(entry.element);
    return entry;
  }

  function take(id) {
    const entry = lying.get(id);
    if (!entry) return false;
    if (frozen) {
      refuse(entry.element);
      return false;
    }
    const amount = jar.take(id, clock());
    lying.delete(id);
    const from = entry.element.querySelector('.tip__coin').getBoundingClientRect();
    entry.element.remove();
    // The jar has the last word: a coin pressed in the instant it ran out is gone.
    if (amount > 0) onTake?.(amount, from);
    else onMiss?.();
    return amount > 0;
  }

  function miss(id) {
    const entry = lying.get(id);
    lying.delete(id);
    // It can no longer be pressed, and it is out of the way of the keyboard at once.
    entry.element.disabled = true;
    entry.element.classList.add('tip--gone');
    window.setTimeout(() => entry.element.remove(), GONE_MS);
    onMiss?.();
  }

  return {
    /** A customer has left this coin at the booth they were served at. */
    drop(coin, serverIndex) {
      if (lying.has(coin.id)) return;
      const entry = put(serverIndex, coin.amount);
      // Coins in a pile do not sit exactly on top of one another.
      entry.lean = ((coin.id % 3) - 1) * 3 * Math.min(entry.level, 1);
      entry.coin = coin;
      place(entry);
      entry.element.addEventListener('click', () => take(coin.id));
      lying.set(coin.id, entry);
    },

    /** Once per drawn frame: every ring runs down, and a coin whose ring is empty goes. */
    frame() {
      const now = clock();
      for (const [id, entry] of lying) {
        const left = 1 - (now - entry.coin.leftAt) / TIPS.shelfLife;
        if (left <= 0 || !jar.waiting(id, now)) miss(id);
        else showLeft(entry, Math.min(left, 1));
      }
    },

    /** How many coins are lying on the counter now. */
    get count() {
      return lying.size;
    },

    /** Picks up the coin that has been lying longest: what the keyboard shortcut does. */
    takeOldest() {
      let oldest = null;
      for (const [id, entry] of lying) {
        if (oldest === null || entry.coin.leftAt < lying.get(oldest).coin.leftAt) oldest = id;
      }
      return oldest !== null && take(oldest);
    },

    /** While the day is paused the coins wait, and cannot be picked up. */
    setFrozen(value) {
      frozen = value;
      layer.dataset.frozen = String(value);
    },

    /** After a resize the counter is somewhere else. */
    reposition() {
      for (const entry of lying.values()) place(entry);
    },

    /** Takes every coin off the counter at once, unpicked: the rest of the day is not being watched. */
    clear() {
      for (const entry of lying.values()) entry.element.remove();
      lying.clear();
    },

    /**
     * The coin that has lain longest, to point at while explaining: lit while
     * the day stands still, and an ordinary coin again afterwards. Null when
     * the counter is empty.
     */
    point() {
      let oldest = null;
      for (const entry of lying.values()) if (!oldest || entry.coin.leftAt < oldest.coin.leftAt) oldest = entry;
      if (!oldest) return null;
      oldest.element.classList.add('tip--sample');
      return { element: oldest.element, remove: () => oldest.element.classList.remove('tip--sample') };
    },

    /**
     * A coin to point at while explaining: it looks like one that has just
     * been left, and does nothing. Returns the coin and the way to take it away.
     */
    sample() {
      const entry = put(0, TIPS.amount);
      entry.element.classList.add('tip--sample');
      entry.element.tabIndex = -1;
      showLeft(entry, 0.72);
      return { element: entry.element, remove: () => entry.element.remove() };
    },
  };
}
