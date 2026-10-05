/**
 * The rolling door of the warung, as the way from one part of the day to the
 * next: it comes down over the screen, the screen behind it changes, and it
 * goes up again. Opening in the morning and closing at night are the two
 * moments a warung's door really moves, so those are the changes it is used
 * for.
 *
 * With "reduce motion" switched on the screen simply changes.
 */

import { h } from './dom.js';
import { prefersReducedMotion } from './motion.js';
import { play } from './sound.js';

const DOWN_MS = 420;
const UP_MS = 520;
/** How long the door stays shut, so the sign on it can be read. */
const SHUT_MS = 380;

let rolling = false;

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
/**
 * Resolves when the animation has ended, or a little after it should have.
 * A browser does not run animations in a tab it is not showing, and the
 * change behind the door must not be left waiting for one.
 */
const finished = (animation, ms) => Promise.race([animation.finished.catch(() => {}), wait(ms + 250)]);

/**
 * Rolls the door down, runs `change` behind it, and rolls it up again.
 *
 * @param {() => void} change what happens while the door is shut
 * @param {string} sign what is written on the door: "Buka", "Tutup"
 */
export async function rollShutter(change, sign) {
  // A door already moving is not started again, and nothing is held back for it.
  if (rolling || prefersReducedMotion() || !document.body.animate) {
    change();
    return;
  }
  rolling = true;

  const door = h('div', { class: 'shutter__door' }, [
    h('p', { class: 'shutter__sign', text: sign }),
    h('span', { class: 'shutter__handle' }),
  ]);
  // It only covers the screen for a moment and says nothing a reader needs.
  const shutter = h('div', { class: 'shutter', 'aria-hidden': 'true' }, door);
  document.body.append(shutter);

  try {
    play('shutter');
    await finished(
      door.animate([{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], {
        duration: DOWN_MS,
        easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)',
        fill: 'forwards',
      }),
      DOWN_MS,
    );
    change();
    await wait(SHUT_MS);
    play('shutter');
    await finished(
      door.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], {
        duration: UP_MS,
        easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)',
        fill: 'forwards',
      }),
      UP_MS,
    );
  } finally {
    shutter.remove();
    rolling = false;
  }
}
