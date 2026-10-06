/**
 * Small pieces of motion: a number that counts up, a burst of confetti.
 *
 * Every one of them carries meaning (a result arriving, a game won) and
 * every one of them is skipped when the user has asked the system to reduce
 * motion. None is needed to read the page: the final state is always set,
 * whether or not the motion runs.
 */

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Counts a number up (or down) to its value.
 *
 * @param {HTMLElement} element
 * @param {number} to the final value
 * @param {(value: number) => string} format
 * @param {object} [options]
 * @param {number} [options.from]
 * @param {number} [options.duration] milliseconds
 * @param {number} [options.delay]    milliseconds
 */
export function countUp(element, to, format, { from = 0, duration = 900, delay = 0 } = {}) {
  // The final text is set first, so it is correct even if nothing below runs.
  element.textContent = format(to);
  if (prefersReducedMotion() || from === to) return;

  element.textContent = format(from);
  const start = performance.now() + delay;
  function tick(now) {
    if (!element.isConnected) return;
    const t = Math.min(Math.max((now - start) / duration, 0), 1);
    // Ease out: fast at first, settling onto the value.
    const eased = 1 - (1 - t) ** 3;
    element.textContent = format(from + (to - from) * eased);
    if (t < 1) window.requestAnimationFrame(tick);
    else element.textContent = format(to);
  }
  window.requestAnimationFrame(tick);
}

/**
 * A number steps to its next value like a digit on a counter: the new
 * figure comes up from below when the value went up, and down from above
 * when it went down. The direction is the point: it says which way the
 * press moved the number. Short, because it is seen at every press.
 *
 * @param {HTMLElement} element the figure; whatever holds it should clip
 * @param {number} direction positive = the value went up
 */
export function roll(element, direction) {
  if (prefersReducedMotion() || !element.animate || direction === 0) return;
  const from = direction > 0 ? '45%' : '-45%';
  element.animate(
    [
      { transform: `translateY(${from})`, opacity: 0.25 },
      { transform: 'translateY(0)', opacity: 1 },
    ],
    { duration: 150, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  );
}

/**
 * A wash of color over an element that fades at once: something has just
 * been counted here. Starting it again while it runs simply starts it over.
 */
export function flash(element, color) {
  if (prefersReducedMotion() || !element.animate) return;
  element.animate([{ backgroundColor: color }, { backgroundColor: 'transparent' }], { duration: 520, easing: 'ease-out' });
}

/** A quick pop on a value that has just changed, as feedback for the press that changed it. */
export function pop(element) {
  if (prefersReducedMotion() || !element.animate) return;
  element.animate([{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], {
    duration: 160,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  });
}

/**
 * Numbers that follow from the player's choices. Each is set apart from the
 * fixed words around it, and flashes when it differs from what was shown
 * under the same key before, so the eye is drawn to what a choice changed.
 *
 * @returns {(key: string, text: string) => HTMLElement}
 */
export function createLiveNumbers() {
  const shown = new Map();
  return function live(key, text) {
    const element = document.createElement('strong');
    element.className = 'live';
    element.textContent = text;
    const changed = shown.has(key) && shown.get(key) !== text;
    shown.set(key, text);
    if (changed && !prefersReducedMotion() && element.animate) {
      // The new figure rolls up into place, like a digit on a counter.
      element.animate(
        [
          { backgroundColor: 'var(--kunyit)', transform: 'translateY(40%)', opacity: 0.3 },
          { backgroundColor: 'var(--kunyit-soft)', transform: 'translateY(0)', opacity: 1 },
        ],
        // Several of these go off at every press, so each is brief and does not overshoot.
        { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
    return element;
  };
}

/**
 * Makes a card lean toward the pointer, as if it were picked up to be looked
 * at. Only where there is a pointer that hovers; a finger has nothing to
 * lean toward. The lean itself is in CSS, from --tilt-x and --tilt-y.
 */
export function tilt(element, { degrees = 6 } = {}) {
  if (prefersReducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  element.addEventListener('pointermove', (event) => {
    const box = element.getBoundingClientRect();
    const across = (event.clientX - box.left) / box.width - 0.5;
    const down = (event.clientY - box.top) / box.height - 0.5;
    element.style.setProperty('--tilt-x', `${(-down * degrees).toFixed(2)}deg`);
    element.style.setProperty('--tilt-y', `${(across * degrees).toFixed(2)}deg`);
  });
  element.addEventListener('pointerleave', () => {
    element.style.removeProperty('--tilt-x');
    element.style.removeProperty('--tilt-y');
  });
}

/**
 * Coins that fly from one element to another: the day's profit on its way
 * into the till, or a loss on its way out of it.
 *
 * @param {Element} from
 * @param {Element} to
 * @param {object} [options]
 * @param {number} [options.count]
 * @param {boolean} [options.lost] the coins are a loss: drawn red
 * @param {() => void} [options.onArrive] called as each coin lands
 */
export function flyCoins(from, to, { count = 8, lost = false, onArrive } = {}) {
  if (prefersReducedMotion() || !from?.isConnected || !to?.isConnected || !document.body.animate) return;
  const source = from.getBoundingClientRect();
  const target = to.getBoundingClientRect();
  const endX = target.left + target.width / 2;
  const endY = target.top + target.height / 2;

  for (let i = 0; i < count; i++) {
    const coin = document.createElement('span');
    coin.className = lost ? 'coin coin--lost' : 'coin';
    coin.setAttribute('aria-hidden', 'true');
    document.body.append(coin);

    const startX = source.left + source.width * (0.15 + Math.random() * 0.5);
    const startY = source.top + source.height * (0.3 + Math.random() * 0.4);
    // Each coin takes an arc of its own.
    const lift = 50 + Math.random() * 90;
    const at = (x, y, scale) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale})`;
    coin
      .animate(
        [
          { transform: at(startX, startY, 0.3), opacity: 0 },
          { transform: at(startX, startY - 16, 1), opacity: 1, offset: 0.14 },
          { transform: at((startX + endX) / 2, Math.min(startY, endY) - lift, 1), opacity: 1, offset: 0.55 },
          { transform: at(endX, endY, 0.5), opacity: 0.9 },
        ],
        { duration: 780, delay: i * 75, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'both' },
      )
      .finished.then(() => onArrive?.())
      .catch(() => {})
      .finally(() => coin.remove());
  }
}

/**
 * A burst of paper confetti over the whole window, for a game won.
 * It removes itself when the last piece has fallen.
 */
export function confetti(colors) {
  if (prefersReducedMotion()) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const context = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);

  const pieces = Array.from({ length: 150 }, (_, i) => ({
    x: width / 2 + (Math.random() - 0.5) * width * 0.3,
    y: height * 0.32,
    vx: (Math.random() - 0.5) * 900,
    vy: -Math.random() * 760 - 180,
    size: 6 + Math.random() * 7,
    spin: (Math.random() - 0.5) * 14,
    angle: Math.random() * Math.PI,
    color: colors[i % colors.length],
  }));

  let last = performance.now();
  const started = last;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    context.clearRect(0, 0, width, height);
    for (const piece of pieces) {
      piece.vy += 1500 * dt; // gravity
      piece.vx *= 1 - 1.2 * dt; // air
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.angle += piece.spin * dt;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    const done = now - started > 3200 || pieces.every((piece) => piece.y > height + 20);
    if (done || !canvas.isConnected) canvas.remove();
    else window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
}
