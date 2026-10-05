/**
 * A guided tour: Pak Erlangga points at the controls of a screen, one at a
 * time. The thing he is talking about stays lit while the rest of the page
 * is dimmed, and a card next to it says what it is for.
 *
 * The tour is a native modal <dialog> laid over the whole window: the
 * browser keeps the focus inside it, makes the page behind it inert, and
 * closes it on Escape. The dialog itself is see-through; the dimming is the
 * shadow of a "hole" that sits exactly over the thing being shown.
 */

import { h, icon } from './dom.js';
import { prefersReducedMotion } from './motion.js';
import { avatar, gesture } from './pak-erlangga.js';

/** Space between the thing shown and the edge of the light around it, and between that and the card. */
const HALO = 8;
const GAP = 14;
const EDGE = 10;

/**
 * @param {{ target: Element, title: string, text: string }[]} steps
 * @param {object} [options]
 * @param {() => void} [options.onEnd] called once, however the tour ends
 * @returns {{ close: () => void }}
 */
export function startTour(steps, { onEnd } = {}) {
  let index = 0;
  let frameId = null;

  const hole = h('div', { class: 'tour__hole' });
  const count = h('p', { class: 'tour__count' });
  const title = h('h2', { class: 'tour__title', id: 'tour-title' });
  const text = h('p', { id: 'tour-text' });
  const back = h('button', { type: 'button', class: 'btn btn--quiet' }, [icon('chevron-left'), h('span', { text: 'Kembali' })]);
  const nextLabel = h('span');
  const next = h('button', { type: 'button', class: 'btn btn--primary tour__next' }, [nextLabel, icon('chevron-right')]);
  const skip = h('button', { type: 'button', class: 'tour__skip', text: 'Lewati tutorial' });
  const guide = avatar();
  const card = h('div', { class: 'tour__card' }, [
    h('div', { class: 'tour__head' }, [guide, h('div', {}, [count, title])]),
    text,
    h('div', { class: 'tour__actions' }, [back, next]),
    skip,
  ]);
  const dialog = h('dialog', { class: 'tour', 'aria-labelledby': 'tour-title', 'aria-describedby': 'tour-text' }, [hole, card]);

  /** Keeps the light on the target and the card next to it, wherever the page has scrolled to. */
  function place() {
    frameId = window.requestAnimationFrame(place);
    const rect = steps[index].target.getBoundingClientRect();
    const { innerWidth: width, innerHeight: height } = window;

    hole.style.transform = `translate(${rect.left - HALO}px, ${rect.top - HALO}px)`;
    hole.style.width = `${rect.width + HALO * 2}px`;
    hole.style.height = `${rect.height + HALO * 2}px`;

    // Below the target if there is room, else above it, else at the bottom of the window.
    const cardHeight = card.offsetHeight;
    const cardWidth = card.offsetWidth;
    let top = rect.bottom + HALO + GAP;
    if (top + cardHeight > height - EDGE) top = rect.top - HALO - GAP - cardHeight;
    if (top < EDGE) top = height - cardHeight - EDGE;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - cardWidth / 2, EDGE), Math.max(width - cardWidth - EDGE, EDGE));
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function show(nextIndex) {
    index = nextIndex;
    const step = steps[index];
    const last = index === steps.length - 1;
    count.textContent = `Pak Erlangga · ${index + 1} dari ${steps.length}`;
    title.textContent = step.title;
    text.textContent = step.text;
    back.hidden = index === 0;
    // He waves at the start and talks through the rest.
    gesture(guide, index === 0 ? 'wave' : 'talk');
    nextLabel.textContent = last ? 'Siap, saya mengerti' : 'Lanjut';
    // Something tall is brought to the top of the window, so the card fits under it.
    const tall = step.target.getBoundingClientRect().height > window.innerHeight * 0.4;
    step.target.scrollIntoView({ block: tall ? 'start' : 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    next.focus({ preventScroll: true });
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  back.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => (index === steps.length - 1 ? close() : show(index + 1)));
  skip.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    window.cancelAnimationFrame(frameId);
    dialog.remove();
    onEnd?.();
  });

  document.body.append(dialog);
  dialog.showModal();
  show(0);
  place();

  return { close };
}
