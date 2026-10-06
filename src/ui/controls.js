/** Form controls shared by the views. */

import { h, icon } from './dom.js';
import { integer } from './format.js';
import { roll } from './motion.js';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * A number with a minus and a plus button.
 *
 * The middle is a text field that follows the ARIA spinbutton pattern, so it
 * can show "10.000" with its thousands separator and still be typed into,
 * stepped with the arrow keys, and announced with its limits. A typed value
 * is checked when the field is left or Enter is pressed, not on every key.
 *
 * @param {object} options
 * @param {string} options.id       id of the field, for its <label>
 * @param {string} options.name     what is being counted, for the button labels ("pegawai")
 * @param {number} options.value
 * @param {number} options.min
 * @param {number} options.max
 * @param {number} [options.step]   change per button press or arrow key
 * @param {number} [options.snap]   typed values are rounded to a multiple of this
 * @param {string} [options.prefix] shown before the number ("Rp")
 * @param {string} [options.suffix] shown after the number ("porsi")
 * @param {string} [options.describedBy] ids of the help and error texts
 * @param {boolean} [options.small]
 * @param {(value: number) => void} options.onChange called when the value changes
 */
export function createStepper({
  id,
  name,
  value,
  min,
  max,
  step = 1,
  snap = step,
  prefix,
  suffix,
  describedBy,
  small = false,
  onChange,
}) {
  let current = value;
  let lower = min;
  let upper = max;

  const decrease = h(
    'button',
    { type: 'button', class: 'stepper__btn', 'aria-label': `Kurangi ${name}` },
    icon('minus'),
  );
  const increase = h(
    'button',
    { type: 'button', class: 'stepper__btn', 'aria-label': `Tambah ${name}` },
    icon('plus'),
  );
  const input = h('input', {
    id,
    class: 'stepper__input',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    role: 'spinbutton',
    'aria-describedby': describedBy,
  });
  const element = h('div', { class: small ? 'stepper stepper--small' : 'stepper' }, [
    decrease,
    h('div', { class: 'stepper__field' }, [
      prefix && h('span', { class: 'stepper__unit', 'aria-hidden': 'true', text: prefix }),
      input,
      suffix && h('span', { class: 'stepper__unit', 'aria-hidden': 'true', text: suffix }),
    ]),
    increase,
  ]);

  /** The field is only as wide as its text, so prefix and suffix sit right against the number. */
  function fit() {
    input.style.width = `${Math.max(input.value.length, 1) + 0.5}ch`;
  }

  function render() {
    input.value = integer(current);
    fit();
    input.setAttribute('aria-valuenow', String(current));
    input.setAttribute('aria-valuemin', String(lower));
    input.setAttribute('aria-valuemax', String(upper));
    input.setAttribute('aria-valuetext', [prefix, integer(current), suffix].filter(Boolean).join(' '));
    decrease.disabled = current <= lower;
    increase.disabled = current >= upper;
  }

  /** @param {boolean} [shown] the change is acted out; not for the keyboard, where it would only slow the keys down */
  function commit(next, shown = false) {
    const snapped = clamp(Math.round(next / snap) * snap, lower, upper);
    const direction = Math.sign(snapped - current);
    current = snapped;
    render();
    if (direction !== 0) {
      if (shown) roll(input, direction);
      onChange(current);
    }
  }

  /** Reads what was typed; anything that is not a number leaves the value as it was. */
  function commitTyped() {
    const digits = input.value.replace(/[^\d]/g, '');
    if (digits === '') render();
    else commit(Number(digits));
  }

  // A click made with the keyboard (detail 0) is not acted out either.
  decrease.addEventListener('click', (event) => commit(current - step, event.detail > 0));
  increase.addEventListener('click', (event) => commit(current + step, event.detail > 0));
  input.addEventListener('blur', commitTyped);
  input.addEventListener('input', fit);
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (event) => {
    const moves = {
      ArrowUp: current + step,
      ArrowDown: current - step,
      PageUp: current + step * 5,
      PageDown: current - step * 5,
      Home: lower,
      End: upper,
    };
    if (event.key in moves) {
      event.preventDefault();
      commit(moves[event.key]);
      input.select();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commitTyped();
      input.select();
    }
  });

  render();

  return {
    element,
    input,
    get value() {
      return current;
    },
    /** Sets the value from outside, without calling onChange. */
    set(next) {
      current = clamp(next, lower, upper);
      render();
    },
    /** Changes the limits; a value outside them moves to the nearest limit, silently. */
    setBounds(nextMin, nextMax) {
      lower = nextMin;
      upper = nextMax;
      current = clamp(current, lower, upper);
      render();
    },
  };
}

/**
 * Shows a field's problem right under the field, or hides it.
 * The element should have role="alert" so that a new message is announced.
 */
export function showFieldError(element, message) {
  element.hidden = !message;
  element.replaceChildren();
  if (message) element.append(icon('alert'), h('span', { text: message }));
}

/**
 * Tabs: a row of buttons, each showing one panel and hiding the others.
 *
 * They follow the ARIA tabs pattern. Only the selected tab is in the Tab
 * order; the arrow keys, Home, and End move between the tabs and select as
 * they go, so a keyboard user passes the whole row with one press of Tab.
 *
 * @param {object} options
 * @param {string} options.label what the tabs are about, for screen readers
 * @param {{ id: string, label: string, icon?: string, panel: Node | Node[] }[]} options.tabs
 * @param {string} [options.selected] id of the tab to start on
 * @param {(id: string) => void} [options.onSelect] called whenever a tab is shown, the first one included
 * @returns {{ list: HTMLElement, panels: HTMLElement[], select: (id: string) => void }}
 */
export function createTabs({ label, tabs, selected, onSelect }) {
  const buttons = tabs.map((tab) =>
    h('button', { type: 'button', class: 'tabs__tab', role: 'tab', id: `tab-${tab.id}`, 'aria-controls': `panel-${tab.id}` }, [
      tab.icon && icon(tab.icon),
      h('span', { text: tab.label }),
    ]),
  );
  const panels = tabs.map((tab) =>
    h('div', { class: 'tabs__panel', role: 'tabpanel', id: `panel-${tab.id}`, 'aria-labelledby': `tab-${tab.id}`, tabindex: '0' }, tab.panel),
  );
  // The pill under the chosen tab: an ink layer and a turmeric layer inside
  // it, both as large as the bar and both cut down to the tab with clip-path.
  const ink = h('span', { class: 'tabs__ink', 'aria-hidden': 'true' });
  const fill = h('span', { class: 'tabs__fill', 'aria-hidden': 'true' });
  const list = h('div', { class: 'tabs' }, [
    ink,
    fill,
    h('div', { class: 'tabs__list', role: 'tablist', 'aria-label': label }, buttons),
  ]);
  let chosen = 0;

  /**
   * Cuts the two layers down to the chosen tab. With `instant` the pill is
   * simply there: the first time, when the bar changes size, and when the
   * tab was chosen with the keyboard.
   */
  function placePill(instant) {
    const button = buttons[chosen];
    const width = list.clientWidth;
    const height = list.clientHeight;
    if (width === 0) return; // not on the page yet
    const left = button.offsetLeft + button.parentElement.offsetLeft;
    const top = button.offsetTop + button.parentElement.offsetTop;
    const right = width - left - button.offsetWidth;
    const bottom = height - top - button.offsetHeight;
    const radius = parseFloat(getComputedStyle(button).borderTopLeftRadius) || 0;
    const line = 2;
    if (instant) list.dataset.instant = '';
    // The ink reaches a little lower than the turmeric: the lip under a pressed-in button.
    ink.style.clipPath = `inset(${top}px ${right}px ${Math.max(bottom - line, 0)}px ${left}px round ${radius}px)`;
    fill.style.clipPath = `inset(${top + line}px ${right + line}px ${bottom + line}px ${left + line}px round ${Math.max(radius - line, 0)}px)`;
    if (instant) {
      // Let the browser take the new shape before transitions are allowed again.
      void ink.offsetWidth;
      delete list.dataset.instant;
    }
  }
  if ('ResizeObserver' in window) new ResizeObserver(() => placePill(true)).observe(list);

  function select(id, { focus = false, instant = false } = {}) {
    const index = Math.max(tabs.findIndex((tab) => tab.id === id), 0);
    chosen = index;
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
    panels.forEach((panel, i) => {
      panel.hidden = i !== index;
      panel.toggleAttribute('data-instant', instant);
    });
    placePill(instant);
    if (focus) buttons[index].focus();
    onSelect?.(tabs[index].id);
  }

  buttons.forEach((button, i) => {
    button.addEventListener('click', () => select(tabs[i].id));
    button.addEventListener('keydown', (event) => {
      const moves = {
        ArrowRight: (i + 1) % tabs.length,
        ArrowLeft: (i - 1 + tabs.length) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      };
      if (!(event.key in moves)) return;
      event.preventDefault();
      // Arrow keys are pressed in quick succession; nothing is animated for them.
      select(tabs[moves[event.key]].id, { focus: true, instant: true });
    });
  });

  select(selected ?? tabs[0].id);
  return { list, panels, select };
}

/**
 * Explains something in a modal dialog, with one button to close it. Like
 * every native <dialog> it also closes on Escape, and the focus goes back to
 * whatever opened it.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {Node | Node[]} options.body
 * @param {string} [options.closeLabel]
 * @param {Element} [options.opener] what opened it, if that is not where the focus is
 *   (a button that was clicked does not take the focus in every browser)
 */
export function infoDialog({ title, body, closeLabel = 'Mengerti', opener = document.activeElement }) {
  const heading = h('h2', { id: 'info-title', tabindex: '-1', text: title });
  const close = h('button', { type: 'button', class: 'btn btn--primary', text: closeLabel });
  const dialog = h('dialog', { class: 'dialog dialog--wide', 'aria-labelledby': 'info-title' }, [
    heading,
    body,
    h('div', { class: 'dialog__actions' }, close),
  ]);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  document.body.append(dialog);
  dialog.showModal();
  // Reading starts at the top, not at the button under the text.
  heading.focus({ preventScroll: true });
}

/**
 * Asks for confirmation in a modal dialog. The native <dialog> keeps focus
 * inside while it is open, closes on Escape, and returns focus to where it was.
 *
 * @returns {Promise<boolean>} whether the user confirmed
 */
export function confirmDialog({ title, body, confirmLabel, cancelLabel = 'Batal', danger = false }) {
  return new Promise((resolve) => {
    const cancel = h('button', { type: 'button', class: 'btn', value: 'cancel', text: cancelLabel });
    const confirm = h('button', {
      type: 'button',
      class: danger ? 'btn btn--danger' : 'btn btn--primary',
      text: confirmLabel,
    });
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'dialog-title' }, [
      h('h2', { id: 'dialog-title', text: title }),
      h('p', { text: body }),
      h('div', { class: 'dialog__actions' }, [cancel, confirm]),
    ]);

    // Whatever opened the dialog gets the focus back when it is dismissed.
    const opener = document.activeElement;
    let confirmed = false;
    cancel.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
      confirmed = true;
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (!confirmed && opener?.isConnected) opener.focus({ preventScroll: true });
      resolve(confirmed);
    });

    document.body.append(dialog);
    dialog.showModal();
    // The safe choice gets the focus, so Enter does not destroy anything.
    cancel.focus();
  });
}
