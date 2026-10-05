/** Small helpers for building DOM without a framework. */

const SVG_NS = 'http://www.w3.org/2000/svg';

function setAttributes(element, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (name === 'class') {
      element.setAttribute('class', value);
    } else if (name === 'text') {
      element.textContent = value;
    } else if (name.startsWith('on')) {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name.startsWith('aria-')) {
      // ARIA states are written out in full: aria-pressed="false" is meaningful.
      element.setAttribute(name, String(value));
    } else if (value === true) {
      element.setAttribute(name, '');
    } else if (value !== false) {
      element.setAttribute(name, String(value));
    }
  }
}

function append(parent, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    parent.append(child);
  }
}

/**
 * Creates an element.
 *
 * @param {string} tag
 * @param {object} [attrs] attributes; `class`, `text`, and `on<event>` are
 *   handled specially, and false, null, or undefined values are left out
 * @param {Array|Node|string} [children] nodes or strings, nested arrays allowed
 */
export function h(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  setAttributes(element, attrs);
  append(element, children);
  return element;
}

/** Creates an SVG element (SVG needs its own namespace). */
export function svg(tag, attrs = {}, children = []) {
  const element = document.createElementNS(SVG_NS, tag);
  setAttributes(element, attrs);
  append(element, children);
  return element;
}

/**
 * An icon from the sprite in index.html. Icons are decoration next to
 * visible text, so they are hidden from assistive technology; a control
 * that shows only an icon gets its name from aria-label on the control.
 */
export function icon(name, className = 'icon') {
  return svg('svg', { class: className, 'aria-hidden': 'true', focusable: 'false' }, [
    svg('use', { href: `#i-${name}` }),
  ]);
}
