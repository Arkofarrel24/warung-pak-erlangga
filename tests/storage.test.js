/**
 * Saving the game. The storage is passed in, so these tests run in Node with
 * a stand-in for the browser's localStorage, including ones that fail.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultDecisions, newGame, playDay } from '../src/game/game.js';
import {
  clearGame,
  loadGame,
  loadPrefs,
  loadSession,
  saveGame,
  savePrefs,
  saveSession,
} from '../src/game/storage.js';

/** Behaves like localStorage: string keys, string values. */
function fakeStorage() {
  const items = new Map();
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

/** A storage whose every method throws, as in a browser with storage switched off. */
function brokenStorage() {
  const fail = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

function gameInProgress() {
  let state = newGame(11);
  for (let day = 0; day < 2; day++) state = playDay(state, defaultDecisions(state)).state;
  return state;
}

test('a saved game comes back exactly as it was', () => {
  const storage = fakeStorage();
  const state = gameInProgress();

  assert.equal(saveGame(state, storage), true);
  assert.deepEqual(loadGame(storage), state);
  assert.equal(storage.items.size, 1);
});

test('a loaded game can be played on, and plays the same as the original', () => {
  const storage = fakeStorage();
  const state = gameInProgress();
  saveGame(state, storage);
  const loaded = loadGame(storage);

  assert.deepEqual(
    playDay(loaded, defaultDecisions(loaded)),
    playDay(state, defaultDecisions(state)),
  );
});

test('saving again replaces the earlier save', () => {
  const storage = fakeStorage();
  const first = newGame(1);
  const second = gameInProgress();

  saveGame(first, storage);
  saveGame(second, storage);
  assert.deepEqual(loadGame(storage), second);
  assert.equal(storage.items.size, 1);
});

test('with nothing saved there is nothing to load', () => {
  assert.equal(loadGame(fakeStorage()), null);
});

test('clearing removes the save', () => {
  const storage = fakeStorage();
  saveGame(newGame(1), storage);

  assert.equal(clearGame(storage), true);
  assert.equal(loadGame(storage), null);
  assert.equal(storage.items.size, 0);
});

test('a storage that throws does not break the game', () => {
  const storage = brokenStorage();

  assert.equal(saveGame(newGame(1), storage), false);
  assert.equal(loadGame(storage), null);
  assert.equal(clearGame(storage), false);
});

test('a full storage reports that the game was not saved', () => {
  const storage = fakeStorage();
  storage.setItem = () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  };
  assert.equal(saveGame(newGame(1), storage), false);
});

test('a damaged or foreign save is ignored', () => {
  const state = newGame(1);
  const unusable = [
    'not json at all {',
    'null',
    '42',
    '"a string"',
    '[]',
    '{}',
    JSON.stringify({ ...state, version: 99 }), // written by another version
    JSON.stringify({ ...state, cash: null }), // a number went missing
    JSON.stringify({ ...state, status: 'paused' }),
    JSON.stringify({ ...state, history: 'none' }),
    JSON.stringify({ ...state, upgrades: null }),
  ];
  for (const raw of unusable) {
    const storage = fakeStorage();
    storage.items.set('warung-pak-erlangga:save', raw);
    assert.equal(loadGame(storage), null, raw.slice(0, 40));
  }
});

test('without any storage at all, saving fails quietly', () => {
  // No storage is passed, and Node has no localStorage to fall back on: the
  // same situation as a browser that refuses access to it.
  const hadStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Access is denied.', 'SecurityError');
    },
  });
  try {
    assert.equal(saveGame(newGame(1)), false);
    assert.equal(loadGame(), null);
    assert.equal(clearGame(), false);
  } finally {
    if (hadStorage) Object.defineProperty(globalThis, 'localStorage', hadStorage);
    else delete globalThis.localStorage;
  }
});

test('the browser storage is used when no storage is passed', () => {
  const storage = fakeStorage();
  const hadStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    const state = newGame(5);
    assert.equal(saveGame(state), true);
    assert.deepEqual(loadGame(), state);
  } finally {
    if (hadStorage) Object.defineProperty(globalThis, 'localStorage', hadStorage);
    else delete globalThis.localStorage;
  }
});

test('the session is kept next to the game and comes back as it was', () => {
  const storage = fakeStorage();
  const session = { route: '#/laporan/2', draftDay: 3, draft: { staff: 3, price: 12_000 } };

  assert.equal(saveSession(session, storage), true);
  assert.deepEqual(loadSession(storage), session);
  assert.equal(loadGame(storage), null, 'a session is not a game');
});

test('a missing, damaged, or unreadable session is an empty one', () => {
  assert.deepEqual(loadSession(fakeStorage()), {});
  assert.deepEqual(loadSession(brokenStorage()), {});
  assert.equal(saveSession({ route: '#/pagi' }, brokenStorage()), false);

  for (const raw of ['not json {', 'null', '42', '[]', '"text"']) {
    const storage = fakeStorage();
    storage.items.set('warung-pak-erlangga:session', raw);
    assert.deepEqual(loadSession(storage), {}, raw);
  }
});

test('clearing the game clears the session too', () => {
  const storage = fakeStorage();
  saveGame(newGame(1), storage);
  saveSession({ route: '#/pagi' }, storage);

  assert.equal(clearGame(storage), true);
  assert.deepEqual(loadSession(storage), {});
  assert.equal(storage.items.size, 0);
});

test('preferences come back as they were, and outlive a cleared game', () => {
  const storage = fakeStorage();
  saveGame(newGame(4), storage);
  saveSession({ route: '#/pagi' }, storage);

  assert.equal(savePrefs({ sound: false, tourSeen: true }, storage), true);
  clearGame(storage);

  assert.equal(loadGame(storage), null);
  assert.deepEqual(loadSession(storage), {});
  assert.deepEqual(loadPrefs(storage), { sound: false, tourSeen: true });
});

test('missing, damaged, or unreadable preferences are empty ones', () => {
  assert.deepEqual(loadPrefs(fakeStorage()), {});
  assert.deepEqual(loadPrefs(brokenStorage()), {});
  assert.equal(savePrefs({ sound: true }, brokenStorage()), false);

  for (const raw of ['{not json', 'null', '[1,2]', '"sound"']) {
    const storage = fakeStorage();
    storage.setItem('warung-pak-erlangga:prefs', raw);
    assert.deepEqual(loadPrefs(storage), {}, raw);
  }
});
