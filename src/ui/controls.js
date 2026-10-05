/** Form controls shared by the views. */

import { h, icon } from './dom.js';
import { integer } from './format.js';
import { pop } from './motion.js';

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

  function commit(next) {
    const snapped = clamp(Math.round(next / snap) * snap, lower, upper);
    const changed = snapped !== current;
    current = snapped;
    render();
    if (changed) {
      pop(input);
      onChange(current);
    }
  }

  /** Reads what was typed; anything that is not a number leaves the value as it was. */
  function commitTyped() {
    const digits = input.value.replace(/[^\d]/g, '');
    if (digits === '') render();
    else commit(Number(digits));
  }

  decrease.addEventListener('click', () => commit(current - step));
  increase.addEventListener('click', () => commit(current + step));
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
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': label }, buttons);

  function select(id, { focus = false } = {}) {
    const index = Math.max(tabs.findIndex((tab) => tab.id === id), 0);
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
    panels.forEach((panel, i) => {
      panel.hidden = i !== index;
    });
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
      select(tabs[moves[event.key]].id, { focus: true });
    });
  });

  select(selected ?? tabs[0].id);
  return { list, panels, select };
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

    let confirmed = false;
    cancel.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
      confirmed = true;
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(confirmed);
    });

    document.body.append(dialog);
    dialog.showModal();
    // The safe choice gets the focus, so Enter does not destroy anything.
    cancel.focus();
  });
}
