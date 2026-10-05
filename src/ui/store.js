/**
 * The one place the interface keeps its data: the game, the session (which
 * screen the player was on and the decisions they were working on), and the
 * preferences (sound, the first-day guide). All are written to the browser's
 * storage as they change.
 */

import { clearGame, loadGame, loadPrefs, loadSession, saveGame, savePrefs, saveSession } from '../game/storage.js';

export function createStore() {
  let game = loadGame();
  let session = loadSession();
  let prefs = loadPrefs();
  let saveFailed = false;

  return {
    /** The current game state, or null before a game has been started. */
    get game() {
      return game;
    },
    get session() {
      return session;
    },
    /** True when the browser refused the last save; the game goes on unsaved. */
    get saveFailed() {
      return saveFailed;
    },
    setGame(next) {
      game = next;
      saveFailed = !saveGame(next);
    },
    /** Merges a change into the session. */
    remember(patch) {
      session = { ...session, ...patch };
      saveSession(session);
    },
    /** Choices that outlive a game: they stay when a new game is started. */
    get prefs() {
      return prefs;
    },
    setPrefs(patch) {
      prefs = { ...prefs, ...patch };
      savePrefs(prefs);
    },
    /** Forgets the game and the session. */
    clear() {
      game = null;
      session = {};
      clearGame();
    },
  };
}
