/**
 * Pak Erlangga: his portrait, and the bubble he speaks in.
 *
 * The portrait is drawn here, piece by piece, so that the pieces can move.
 * He is never quite still: he breathes and blinks all the time, and every few
 * seconds does one small thing picked at random (a glance to the side, a
 * raised eyebrow, a twitch of the moustache). On top of that the screens ask
 * him for a gesture when something happens: he talks when his words change,
 * waves in greeting, cheers at a purchase, shakes his head at an empty till,
 * claps when the warung is busy, and scratches his head when customers leave.
 *
 * All of the movement is CSS (see "Pak Erlangga" in base.css); this file only
 * says which movement, by setting data-gesture and data-mood on the portrait.
 * With "reduce motion" switched on he keeps still.
 */

import { h, svg } from './dom.js';
import { prefersReducedMotion } from './motion.js';

/** Every gesture, with how long it takes in milliseconds. */
const GESTURES = Object.freeze({
  // Small things he does on his own.
  glance: 1500,
  brows: 1100,
  tilt: 1700,
  nod: 1100,
  wiggle: 900,
  peci: 1300,
  grin: 1500,
  // Things he is asked to do.
  talk: 1700,
  wave: 2200,
  cheer: 1000,
  shake: 900,
  clap: 1200,
  scratch: 1600,
});
const IDLE = ['glance', 'brows', 'tilt', 'nod', 'wiggle', 'peci', 'grin'];
/** The wait between two idle gestures, in milliseconds: at least, and at most this much more. */
const IDLE_WAIT = 2600;
const IDLE_SPREAD = 3400;

const timers = new WeakMap();
let portraits = 0;

/**
 * Makes the portrait do something once.
 *
 * @param {Element} portrait an element made by avatar()
 * @param {keyof typeof GESTURES} name
 */
export function gesture(portrait, name) {
  if (!portrait || prefersReducedMotion()) return;
  window.clearTimeout(timers.get(portrait));
  // Taking the attribute off and reading a style restarts a gesture that is asked for twice in a row.
  delete portrait.dataset.gesture;
  void portrait.getBoundingClientRect();
  portrait.dataset.gesture = name;
  timers.set(
    portrait,
    window.setTimeout(() => delete portrait.dataset.gesture, GESTURES[name]),
  );
}

/** Every few seconds, one small gesture at random, for as long as the portrait is on the page. */
function keepAlive(portrait) {
  if (prefersReducedMotion()) return;
  let last = null;
  const wait = () =>
    window.setTimeout(() => {
      // The screen he was on is gone: stop.
      if (!portrait.isConnected) return;
      if (!portrait.dataset.gesture) {
        const choices = IDLE.filter((name) => name !== last);
        last = choices[Math.floor(Math.random() * choices.length)];
        gesture(portrait, last);
      }
      wait();
    }, IDLE_WAIT + Math.random() * IDLE_SPREAD);
  wait();
}

/**
 * Pak Erlangga's portrait: a peci, a moustache, and a green shirt.
 *
 * @param {object} [options]
 * @param {'happy' | 'sad'} [options.mood] how he looks for as long as he is shown
 */
export function avatar({ mood } = {}) {
  const clipId = `pak-erlangga-clip-${++portraits}`;
  const ink = 'stroke: var(--ink); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round';
  const thin = 'fill: none; stroke: var(--ink); stroke-width: 2.4; stroke-linecap: round';

  const portrait = svg('svg', { class: 'avatar', viewBox: '0 0 96 96', 'aria-hidden': 'true', focusable: 'false', 'data-mood': mood }, [
    svg('clipPath', { id: clipId }, svg('circle', { cx: 48, cy: 48, r: 44.5 })),
    svg('circle', { cx: 48, cy: 48, r: 46, style: 'fill: var(--kunyit-soft)' }),
    svg('g', { 'clip-path': `url(#${clipId})` }, [
      // Shoulders, which rise and fall as he breathes.
      svg('g', { class: 'avatar__body', style: ink }, [
        svg('path', { d: 'M14 98c2-21 15-31 34-31s32 10 34 31z', style: 'fill: var(--daun)' }),
        svg('path', { d: 'M39 67l9 10 9-10', style: 'fill: #fff' }),
      ]),
      // The head floats a little all the time (bob); gestures turn and nod it (head).
      svg('g', { class: 'avatar__bob' }, [
        svg('g', { class: 'avatar__head' }, [
          svg('ellipse', { cx: 48, cy: 45, rx: 19, ry: 21, style: `${ink}; fill: var(--kulit-1)` }),
          svg('g', { class: 'avatar__cheeks', style: 'fill: var(--sambal)' }, [
            svg('circle', { cx: 34.5, cy: 53, r: 3.6 }),
            svg('circle', { cx: 61.5, cy: 53, r: 3.6 }),
          ]),
          svg('path', {
            class: 'avatar__peci',
            d: 'M28.5 38c0-13 8.5-20 19.5-20s19.5 7 19.5 20c-12.5-4.5-26.5-4.5-39 0z',
            style: `${ink}; fill: var(--ink)`,
          }),
          svg('g', { class: 'avatar__brows', style: thin }, [
            svg('path', { class: 'avatar__brow avatar__brow--left', d: 'M36.5 41.2l7.5-1.2' }),
            svg('path', { class: 'avatar__brow avatar__brow--right', d: 'M52 40l7.5 1.2' }),
          ]),
          svg('g', { class: 'avatar__eyes', style: 'fill: var(--ink)' }, [
            svg('g', { class: 'avatar__pupils' }, [
              svg('circle', { cx: 40.5, cy: 46.5, r: 2.4 }),
              svg('circle', { cx: 55.5, cy: 46.5, r: 2.4 }),
            ]),
          ]),
          svg('path', { class: 'avatar__smile', d: 'M43 61.5c3 2.5 7 2.5 10 0', style: thin }),
          svg('ellipse', { class: 'avatar__mouth', cx: 48, cy: 62.5, rx: 3.4, ry: 2.6, style: 'fill: var(--ink)' }),
          svg('path', {
            class: 'avatar__moustache',
            d: 'M37.5 56.5c3.5-3.5 7.5-3 10.5-.5 3-2.5 7-3 10.5.5-4 2.5-7.5 2-10.5 0-3 2-6.5 2.5-10.5 0z',
            style: 'fill: var(--ink)',
          }),
        ]),
      ]),
      // A hand, kept below the edge of the picture until he waves.
      svg('g', { class: 'avatar__hand', style: ink }, [
        // The sleeve is long, so the arm stays whole when the hand goes up to his head.
        svg('path', { d: 'M66 150l4-69h11l4 69z', style: 'fill: var(--daun)' }),
        svg('circle', { cx: 75.5, cy: 74, r: 7.5, style: 'fill: var(--kulit-1)' }),
        svg('path', { d: 'M71 70.5v-4M75.5 69.5v-5M80 70.5v-4', style: 'fill: none; stroke-width: 2.6' }),
      ]),
    ]),
    svg('circle', { cx: 48, cy: 48, r: 46, style: 'fill: none; stroke: var(--ink); stroke-width: 3' }),
  ]);

  // A tap on him gets a small reaction: he is not a control, only good company.
  portrait.addEventListener('click', () => gesture(portrait, portrait.dataset.gesture === 'wave' ? 'cheer' : 'wave'));
  keepAlive(portrait);
  return portrait;
}

/**
 * Something Pak Erlangga says.
 *
 * @param {Node | Node[]} children his words
 * @param {object} [options]
 * @param {'happy' | 'sad'} [options.mood]
 * @param {keyof typeof GESTURES} [options.greet] what he does as the bubble appears; he talks by default
 * @returns {HTMLElement} the bubble; pass it to speak() when his words change
 */
export function bubble(children, { mood, greet = 'talk' } = {}) {
  const portrait = avatar({ mood });
  // He starts once the screen has slid into place.
  window.setTimeout(() => gesture(portrait, greet), 450);
  return h('div', { class: 'bubble' }, [
    portrait,
    h('div', { class: 'bubble__text' }, [h('span', { class: 'bubble__name', text: 'Pak Erlangga' }), children]),
  ]);
}

/** Has the portrait of a bubble do something: by default, talk. */
export function speak(bubbleElement, name = 'talk') {
  gesture(bubbleElement.querySelector('.avatar'), name);
}
