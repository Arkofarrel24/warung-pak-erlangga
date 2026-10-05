/**
 * Plays a simulation in front of the player.
 *
 * The engine is not slowed down or imitated: it is the same engine, advanced
 * event by event in step with the wall clock, and drawn as it goes. The only
 * thing chosen here is the pace, in simulated hours per second.
 */

import { prefersReducedMotion } from './motion.js';

/** The most time one frame may spend running the engine, so the animation stays smooth. */
const FRAME_BUDGET_MS = 8;
/** With more events than this in one frame, figures are placed directly instead of animated. */
const SNAP_THRESHOLD = 8;

/**
 * @param {object} options
 * @param {import('../sim/engine.js').QueueSimulation} options.simulation
 * @param {import('./warung-scene.js').WarungScene} options.scene
 * @param {number} options.hoursPerSecond simulated hours per second at pace 1
 * @param {(clock: number) => number} [options.dayHour] the hour of the day to light the sky by
 * @param {(record: object) => void} [options.onRecord] called for every event the engine processes
 * @param {(clock: number) => void} [options.onFrame]   called once per drawn frame
 * @param {() => void} [options.onEnd] called once, when the simulation has finished
 */
export function createScenePlayer({ simulation, scene, hoursPerSecond, dayHour = (clock) => clock, onRecord, onFrame, onEnd }) {
  let playing = false;
  let pace = 1;
  let clock = simulation.clock;
  let frameId = null;
  let lastFrame = 0;
  let ended = false;

  function advance(dt) {
    const target = clock + dt * hoursPerSecond * pace;
    const deadline = performance.now() + FRAME_BUDGET_MS;
    const records = [];
    let outOfTime = false;

    while (!simulation.finished) {
      const next = simulation.fel.peek();
      if (next && next.time > target) break;
      // With nothing left to happen, this step ends the simulation.
      const record = simulation.step();
      records.push(record);
      onRecord?.(record);
      if ((records.length & 63) === 0 && performance.now() > deadline) {
        outOfTime = true;
        break;
      }
    }

    // When the work budget runs out, the clock on display follows the engine.
    clock = simulation.finished || outOfTime ? simulation.clock : target;

    const animate = records.length <= SNAP_THRESHOLD && !prefersReducedMotion();
    if (animate) records.forEach((record) => scene.handle(record));
    if (records.length > 0) scene.sync(simulation, animate);
  }

  function frame(now) {
    frameId = window.requestAnimationFrame(frame);
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;

    if (playing && !simulation.finished) advance(dt);
    scene.draw(dt, { clock, dayHour: dayHour(clock), pace, closed: simulation.closed });
    onFrame?.(clock);

    if (simulation.finished && !ended) {
      ended = true;
      onEnd?.();
    }
  }

  return {
    get playing() {
      return playing;
    },
    get clock() {
      return clock;
    },
    get pace() {
      return pace;
    },
    /** Starts drawing. The simulation only moves while playing. */
    start() {
      if (frameId !== null) return;
      scene.sync(simulation, false);
      lastFrame = performance.now();
      frameId = window.requestAnimationFrame(frame);
    },
    /** Stops drawing altogether, for when the view goes away. */
    stop() {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
    },
    play() {
      playing = true;
    },
    pause() {
      playing = false;
    },
    setPace(next) {
      pace = next;
    },
    /** Runs the rest of the simulation at once. */
    skip() {
      while (!simulation.finished) {
        // The step must not sit inside the optional call: with no onRecord,
        // `onRecord?.(simulation.step())` would skip the step as well, and
        // this loop would never end.
        const record = simulation.step();
        onRecord?.(record);
      }
      clock = simulation.clock;
      scene.sync(simulation, false);
    },
    /** Redraws once, for a resize while paused. */
    redraw() {
      scene.sync(simulation, false);
      scene.draw(0, { clock, dayHour: dayHour(clock), pace, closed: simulation.closed });
    },
  };
}
