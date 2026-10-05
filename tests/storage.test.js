/**
 * Saving the game. The storage is passed in, so these tests run in Node with
 * a stand-in for the browser's localStorage, including ones that fail.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultDecisions, newGame, playDay } from '../src/game/game.js';
import { clearGame, loadGame, saveGame } from '../src/game/storage.js';

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
    storage.items.set('warung-pak-erlang:save', raw);
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
