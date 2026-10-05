/**
 * Saving the game in the browser.
 *
 * localStorage can fail in ordinary situations: private browsing, storage
 * that is full or switched off, a page opened from a file. Even reading the
 * `localStorage` property can throw. So every access is wrapped in
 * try/catch, and a failure only means "not saved" or "nothing to load";
 * the game itself goes on.
 */

import { SAVE_VERSION, STATUS } from './game.js';

const KEY = 'warung-pak-erlangga:save';
const SESSION_KEY = 'warung-pak-erlangga:session';
const PREFS_KEY = 'warung-pak-erlangga:prefs';

/** Runs `action` on the storage, and returns `fallback` if anything throws. */
function attempt(storage, action, fallback) {
  try {
    return action(storage ?? globalThis.localStorage);
  } catch {
    return fallback;
  }
}

/** @returns {boolean} whether the game was saved */
export function saveGame(state, storage) {
  return attempt(
    storage,
    (store) => {
      store.setItem(KEY, JSON.stringify(state));
      return true;
    },
    false,
  );
}

/**
 * @returns the saved state, or null when there is none or it cannot be used
 *   (unreadable, damaged, or written by another version of the game)
 */
export function loadGame(storage) {
  return attempt(
    storage,
    (store) => {
      const raw = store.getItem(KEY);
      if (raw === null || raw === undefined) return null;
      const state = JSON.parse(raw);
      return isUsableSave(state) ? state : null;
    },
    null,
  );
}

/** Removes the save and the session. @returns {boolean} whether they were removed */
export function clearGame(storage) {
  return attempt(
    storage,
    (store) => {
      store.removeItem(KEY);
      store.removeItem(SESSION_KEY);
      return true;
    },
    false,
  );
}

/**
 * The session: where the player was and the decisions they were still
 * working on. It is a convenience, kept apart from the game itself, so that
 * reloading the page does not throw away a half-filled morning.
 *
 * @returns {boolean} whether the session was saved
 */
export function saveSession(session, storage) {
  return attempt(
    storage,
    (store) => {
      store.setItem(SESSION_KEY, JSON.stringify(session));
      return true;
    },
    false,
  );
}

/** @returns {object} the saved session, or an empty one */
export function loadSession(storage) {
  return attempt(
    storage,
    (store) => {
      const session = JSON.parse(store.getItem(SESSION_KEY));
      return session !== null && typeof session === 'object' && !Array.isArray(session) ? session : {};
    },
    {},
  );
}

/**
 * Preferences: choices about the game as a whole rather than about one play
 * of it (sound on or off, whether the first-day guide has been seen). They
 * are kept apart from the save and the session, so starting a new game does
 * not forget them.
 *
 * @returns {boolean} whether the preferences were saved
 */
export function savePrefs(prefs, storage) {
  return attempt(
    storage,
    (store) => {
      store.setItem(PREFS_KEY, JSON.stringify(prefs));
      return true;
    },
    false,
  );
}

/** @returns {object} the saved preferences, or none */
export function loadPrefs(storage) {
  return attempt(
    storage,
    (store) => {
      const prefs = JSON.parse(store.getItem(PREFS_KEY));
      return prefs !== null && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
    },
    {},
  );
}

/** A saved state is used only if it has the shape this version of the game writes. */
function isUsableSave(state) {
  const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
  return (
    state !== null &&
    typeof state === 'object' &&
    state.version === SAVE_VERSION &&
    Number.isInteger(state.seed) &&
    Number.isInteger(state.day) &&
    Object.values(STATUS).includes(state.status) &&
    isNumber(state.cash) &&
    isNumber(state.reputation) &&
    Number.isInteger(state.seatsOwned) &&
    Number.isInteger(state.trainingLevel) &&
    state.upgrades !== null &&
    typeof state.upgrades === 'object' &&
    Array.isArray(state.history)
  );
}
