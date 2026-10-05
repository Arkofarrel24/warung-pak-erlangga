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

/** @returns {boolean} whether the save was removed */
export function clearGame(storage) {
  return attempt(
    storage,
    (store) => {
      store.removeItem(KEY);
      return true;
    },
    false,
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
