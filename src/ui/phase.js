/**
 * The time of day, as the header shows it: the menu board takes on the light
 * of the sky outside. Each screen belongs to a part of the day (the morning
 * is planned at dawn, the report is read at night), and while the warung is
 * open the header follows the clock of the simulation.
 *
 * The colors themselves are in tokens.css, under :root[data-phase].
 */

import { DAY } from '../game/config.js';

export const PHASE = Object.freeze({
  DAWN: 'pagi',
  NOON: 'siang',
  AFTERNOON: 'sore',
  DUSK: 'petang',
  NIGHT: 'malam',
});

/** The parts of an opening day, each lasting until the hour given (hours since opening). */
const PARTS = [
  [DAY.hours * 0.25, PHASE.DAWN, 'Pagi'],
  [DAY.hours * 0.5, PHASE.NOON, 'Siang'],
  [DAY.hours * 0.75, PHASE.AFTERNOON, 'Sore'],
  [DAY.hours, PHASE.DUSK, 'Petang'],
];

/** The phase at an hour since opening; night once the doors have closed. */
export function phaseAt(hour) {
  return PARTS.find(([until]) => hour < until)?.[1] ?? PHASE.NIGHT;
}

/** What that part of the day is called on screen. */
export function phaseName(hour) {
  return PARTS.find(([until]) => hour < until)?.[2] ?? 'Tutup';
}

/** Lights the header for a part of the day, or returns it to the plain board. */
export function setPhase(phase) {
  const root = document.documentElement;
  // Called on every frame by the scenes, so it does nothing when nothing changes.
  if (root.dataset.phase === phase) return;
  if (phase) root.dataset.phase = phase;
  else delete root.dataset.phase;
}
