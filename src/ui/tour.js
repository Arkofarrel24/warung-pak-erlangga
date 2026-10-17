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
 * @param {{ target: Element | (() => Element), title: string, text: string }[]} steps
 *   a target outside the screen being toured (in the header, say) is given as a function that finds it
 * @param {object} [options]
 * @param {() => void} [options.onEnd] called once, however the tour ends
 * @returns {{ close: () => void }}
 */
export function startTour(steps, { onEnd } = {}) {
  let index = 0;
  let frameId = null;
  /** Whether the light and the card have been put where the first step is. */
  let placed = false;
  const targetOf = (step) => (typeof step.target === 'function' ? step.target() : step.target);

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
    // From the second frame on, a change of place is a journey (see data-placed in app.css).
    if (placed) dialog.dataset.placed = '';
    placed = true;
    const rect = targetOf(steps[index]).getBoundingClientRect();
    const { innerWidth: width, innerHeight: height } = window;

    hole.style.transform = `translate(${rect.left - HALO}px, ${rect.top - HALO}px)`;
    hole.style.width = `${rect.width + HALO * 2}px`;
    hole.style.height = `${rect.height + HALO * 2}px`;

    // The card never covers what it is about, as long as there is room
    // anywhere around it: below, else above, else beside it. Only when the
    // target fills the window does the card lie over its lower part.
    const cardHeight = card.offsetHeight;
    const cardWidth = card.offsetWidth;
    const within = (value, size, limit) => Math.min(Math.max(value, EDGE), Math.max(limit - size - EDGE, EDGE));
    const reach = HALO + GAP;
    let left = within(rect.left + rect.width / 2 - cardWidth / 2, cardWidth, width);
    let top = rect.bottom + reach;
    if (top + cardHeight > height - EDGE) {
      top = rect.top - reach - cardHeight;
      if (top < EDGE) {
        const beside = within(rect.top + rect.height / 2 - cardHeight / 2, cardHeight, height);
        if (rect.right + reach + cardWidth <= width - EDGE) {
          left = rect.right + reach;
          top = beside;
        } else if (rect.left - reach - cardWidth >= EDGE) {
          left = rect.left - reach - cardWidth;
          top = beside;
        } else {
          top = height - cardHeight - EDGE;
        }
      }
    }
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function show(nextIndex) {
    index = nextIndex;
    const step = steps[index];
    const last = index === steps.length - 1;
    count.textContent = `${index + 1} dari ${steps.length}`;
    // A single step is not a count of anything.
    count.hidden = steps.length === 1;
    title.textContent = step.title;
    text.textContent = step.text;
    back.hidden = index === 0;
    // He waves at the start and talks through the rest.
    gesture(guide, index === 0 ? 'wave' : 'talk');
    nextLabel.textContent = last ? 'Siap, mengerti' : 'Lanjut';
    // The target is brought to the middle of the window if the card then fits
    // under it, and to the top of the window if it does not.
    const rect = targetOf(step).getBoundingClientRect();
    const room = card.offsetHeight + HALO + GAP + EDGE;
    const centred = (window.innerHeight - rect.height) / 2;
    const offset = centred >= room ? centred : HALO + EDGE;
    window.scrollTo({ top: window.scrollY + rect.top - offset, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
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
