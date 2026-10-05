/**
 * Entry point: the store, the routes, the header, and the two actions that
 * change the game (starting a new one, and opening the warung for the day).
 *
 * Each screen has an address, so the browser's back button works and a
 * reload returns to the same place:
 *
 *   #/            the front of the warung
 *   #/pagi        the morning's decisions
 *   #/toko        the shop next door, part of the morning
 *   #/siang       the day in progress
 *   #/laporan/3   the report of day 3
 *   #/akhir       the end of the game
 */

import { DAY } from '../game/config.js';
import { newGame, startDay, STATUS } from '../game/game.js';
import { confirmDialog } from './controls.js';
import { renderDay } from './day-view.js';
import { h, icon } from './dom.js';
import { renderEnd } from './end-view.js';
import { decimal, rupiah, shortRupiah } from './format.js';
import { renderHome } from './home-view.js';
import { countUp } from './motion.js';
import { renderMorning } from './morning-view.js';
import { PHASE, setPhase } from './phase.js';
import { renderReport } from './report-view.js';
import { renderShop } from './shop-view.js';
import { rollShutter } from './shutter.js';
import { play, setSoundEnabled, soundEnabled, unlockSound } from './sound.js';
import { createStore } from './store.js';
import { GAME_NAME, SHOP_NAME } from './text.js';
import { keepWordsWhole } from './typography.js';

const store = createStore();
const main = document.getElementById('main');
const statusBar = document.getElementById('status');
const navigation = document.getElementById('nav');
const announcer = document.getElementById('announce');

let currentView = null;
let firstRender = true;
/** The day being played, from "open the warung" until its books are closed. Not saved. */
let activeDay = null;
/** The cash figure last shown in the header, so a change can count up from it. */
let shownCash = null;

// --- Routes ----------------------------------------------------------------

/** Where a game in its current state belongs when no address says otherwise. */
function homeBase() {
  const { game } = store;
  if (!game) return '#/';
  return game.status === STATUS.PLAYING ? '#/pagi' : '#/akhir';
}

/**
 * Turns any address into one that makes sense for the game as it is now:
 * there is no morning to plan once the game is over, and no report of a day
 * that has not been played.
 */
function resolve(hash) {
  const { game } = store;
  const report = /^#\/laporan\/(\d+)$/.exec(hash);

  if (hash === '#/') return { hash, view: 'home' };
  if (game && report) {
    const day = Number(report[1]);
    if (day >= 1 && day <= game.history.length) return { hash, view: 'report', day };
  }
  if (game?.status === STATUS.PLAYING && hash === '#/pagi') return { hash, view: 'morning' };
  if (game?.status === STATUS.PLAYING && hash === '#/toko') return { hash, view: 'shop' };
  if (activeDay && hash === '#/siang') return { hash, view: 'day' };
  if (game && game.status !== STATUS.PLAYING && hash === '#/akhir') return { hash, view: 'end' };
  return resolve(homeBase());
}

function navigate(hash) {
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

/** Says something to screen-reader users without moving their focus. */
function announce(message) {
  announcer.textContent = '';
  window.requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

// --- Actions ---------------------------------------------------------------

function randomSeed() {
  try {
    return window.crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    return Math.floor(Math.random() * 2 ** 32);
  }
}

async function startNewGame({ confirm }) {
  if (confirm) {
    const inProgress = store.game.status === STATUS.PLAYING;
    const agreed = await confirmDialog({
      title: 'Mulai dari awal?',
      body: inProgress
        ? `Permainan yang sedang berjalan (hari ke-${store.game.day}) akan dihapus dan tidak bisa dikembalikan.`
        : 'Hasil dan laporan permainan terakhir akan dihapus dan tidak bisa dikembalikan.',
      confirmLabel: 'Hapus dan mulai lagi',
      danger: true,
    });
    if (!agreed) return;
  }
  rollShutter(() => {
    activeDay = null;
    store.clear();
    store.setGame(newGame(randomSeed()));
    navigate('#/pagi');
  }, 'Hari pertama');
}

/**
 * Opens the warung with the given decisions. The day is played out on the
 * day screen; nothing is saved until it has ended, so reloading in the
 * middle of a day simply returns to the morning with the decisions intact.
 */
function openWarung(decisions) {
  rollShutter(() => {
    activeDay = startDay(store.game, decisions);
    navigate('#/siang');
  }, 'Buka');
}

/** Closes the books of the day that has just ended and goes to its report. */
function completeDay() {
  rollShutter(() => {
    const { state, report } = activeDay.finish();
    activeDay = null;

    store.setGame(state);
    // A fresh report opens on its summary, whichever tab was read last, and
    // is printed out once (see freshReport in report-view.js).
    store.remember({ draft: null, draftDay: null, reportTab: null, freshReport: report.day });
    const { profit } = report.ledger;
    announce(`Hari ke-${report.day} selesai. ${profit >= 0 ? 'Laba' : 'Rugi'} ${rupiah(Math.abs(profit))}.`);
    navigate(`#/laporan/${report.day}`);
  }, 'Tutup');
}

// --- Header ----------------------------------------------------------------

/** Sound on or off. It is in the header on every screen, with or without a game. */
function soundToggle() {
  const button = h('button', { type: 'button', class: 'papan__link papan__link--icon' });
  // The icon shows how things are; the words, read out and shown on hover, say what a press will do.
  const draw = () => {
    const on = soundEnabled();
    const label = on ? 'Matikan suara' : 'Nyalakan suara';
    button.title = label;
    button.replaceChildren(icon(on ? 'volume' : 'volume-off'), h('span', { text: label }));
  };
  button.addEventListener('click', () => {
    setSoundEnabled(!soundEnabled());
    store.setPrefs({ sound: soundEnabled() });
    draw();
    // Heard at once when switched on, as proof that it works.
    play('sale');
  });
  draw();
  return button;
}

function renderHeader() {
  const { game } = store;
  statusBar.replaceChildren();
  navigation.replaceChildren(soundToggle());
  statusBar.hidden = !game;
  if (!game) {
    shownCash = null;
    return;
  }

  const item = (iconName, label, value, title) =>
    h('div', { class: 'status__item', title }, [
      h('dt', {}, [icon(iconName), h('span', { text: label })]),
      h('dd', { class: 'num', text: value }),
    ]);
  const cash = item('wallet', 'Kas', shortRupiah(game.cash), rupiah(game.cash));
  cash.id = 'status-cash';
  const day = item('sun', 'Hari', `${game.day}/${DAY.count}`);
  // The moon takes the sun's place when the header turns to night (see .status__moon).
  day.querySelector('.icon').classList.add('status__sun');
  day.querySelector('dt').prepend(icon('moon', 'icon status__moon'));
  statusBar.append(
    day,
    cash,
    item('star', 'Reputasi', decimal(game.reputation, 0)),
  );
  // After a day the cash counts up (or down) to its new amount.
  if (shownCash !== null && shownCash !== game.cash) {
    // It waits for the coins of the day's result to reach it (see report-view.js).
    countUp(cash.querySelector('dd'), game.cash, shortRupiah, { from: shownCash, duration: 1100, delay: 2400 });
  }
  shownCash = game.cash;

  if (game.history.length > 0) {
    navigation.append(
      h('a', { class: 'papan__link', href: `#/laporan/${game.history.length}` }, [
        icon('book'),
        h('span', { text: 'Laporan' }),
      ]),
    );
  }
  navigation.append(
    h('button', { type: 'button', class: 'papan__link', onclick: () => startNewGame({ confirm: true }) }, [
      icon('refresh'),
      h('span', { text: 'Mulai ulang' }),
    ]),
  );
}

// --- Rendering -------------------------------------------------------------

/**
 * The part of the day each screen belongs to. The front page and the day in
 * progress are missing on purpose: they follow the clock of their own scene.
 */
const PHASES = {
  morning: PHASE.DAWN,
  shop: PHASE.DAWN,
  report: PHASE.NIGHT,
  end: PHASE.NIGHT,
};

const TITLES = {
  home: () => GAME_NAME,
  morning: () => `Hari ${store.game.day}: pagi · ${GAME_NAME}`,
  shop: () => `${SHOP_NAME} · ${GAME_NAME}`,
  day: () => `Hari ${store.game.day}: warung buka · ${GAME_NAME}`,
  report: (route) => `Laporan hari ke-${route.day} · ${GAME_NAME}`,
  end: () => `Hasil akhir · ${GAME_NAME}`,
};

function render() {
  const route = resolve(window.location.hash || store.session.route || homeBase());
  if (route.hash !== window.location.hash) window.history.replaceState(null, '', route.hash);

  currentView?.destroy?.();
  main.replaceChildren();
  if (route.view in PHASES) setPhase(PHASES[route.view]);

  const context = { store, navigate, startNewGame, openWarung, completeDay, activeDay };
  if (route.view === 'home') currentView = renderHome(main, context);
  else if (route.view === 'morning') currentView = renderMorning(main, context);
  else if (route.view === 'shop') currentView = renderShop(main, context);
  else if (route.view === 'day') currentView = renderDay(main, context);
  else if (route.view === 'report') currentView = renderReport(main, context, route.day);
  else currentView = renderEnd(main, context);

  renderHeader();
  document.title = TITLES[route.view](route);
  // A day in progress is not somewhere to come back to after a reload.
  if (route.view !== 'day') store.remember({ route: route.hash });

  // After a change of screen, start at its top and put the focus on its
  // heading, so a screen reader announces where the user has landed.
  if (!firstRender) {
    window.scrollTo(0, 0);
    currentView.heading?.focus({ preventScroll: true });
  }
  firstRender = false;
}

keepWordsWhole(document.body);
setSoundEnabled(store.prefs.sound !== false);
// A page may not make a sound before the user has touched it. Browsers differ
// in which touch counts, so every kind is listened for until the audio runs.
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
function wakeSound() {
  if (!unlockSound()) return;
  for (const gesture of GESTURES) window.removeEventListener(gesture, wakeSound, true);
}
for (const gesture of GESTURES) window.addEventListener(gesture, wakeSound, true);

window.addEventListener('hashchange', render);
render();
