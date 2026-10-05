/**
 * Small sounds: a bell at the till, a grumble when a customer walks off.
 *
 * Nothing is loaded. Every sound is a few notes made on the spot with the
 * Web Audio API, so the game stays a folder of text files. Sound is only a
 * garnish: nothing is ever said in sound alone, and it can be switched off
 * from the header.
 *
 * Browsers do not let a page make noise before the user has touched it, so
 * the audio context is opened on the first tap or key press (see
 * unlockSound). Until then, and whenever audio is unavailable, play() does
 * nothing.
 */

/**
 * Each sound is a list of notes: the frequency in hertz (`to` to slide to
 * another), when it starts and how long it rings in seconds, and how loud
 * (the peak, where 1 is as loud as the device goes). Around 0.2 to 0.35 is
 * the level of an ordinary notification sound; square waves sound louder
 * than their number and are kept lower.
 */
const SOUNDS = {
  /** The warung opens: a door bell. */
  open: [
    { from: 880, at: 0, length: 0.35, level: 0.35 },
    { from: 1175, at: 0.14, length: 0.5, level: 0.35 },
  ],
  /** A portion sold: the till. */
  sale: [
    { from: 1568, at: 0, length: 0.09, level: 0.175, wave: 'triangle' },
    { from: 2093, at: 0.06, length: 0.22, level: 0.175, wave: 'triangle' },
  ],
  /** A customer gives up waiting. */
  renege: [{ from: 330, to: 175, at: 0, length: 0.26, level: 0.3, wave: 'triangle' }],
  /** A customer finds every stool taken. */
  balk: [
    { from: 233, at: 0, length: 0.08, level: 0.175, wave: 'square' },
    { from: 196, at: 0.1, length: 0.12, level: 0.175, wave: 'square' },
  ],
  /** A customer comes after the food has run out. */
  soldOut: [{ from: 262, to: 196, at: 0, length: 0.3, level: 0.25 }],
  /** A bus of customers pulls up. */
  group: [
    { from: 311, at: 0, length: 0.32, level: 0.15, wave: 'square' },
    { from: 392, at: 0, length: 0.32, level: 0.15, wave: 'square' },
    { from: 311, at: 0.4, length: 0.2, level: 0.15, wave: 'square' },
    { from: 392, at: 0.4, length: 0.2, level: 0.15, wave: 'square' },
  ],
  /** Something unexpected happens. */
  surprise: [
    { from: 740, at: 0, length: 0.1, level: 0.3, wave: 'triangle' },
    { from: 554, at: 0.11, length: 0.1, level: 0.3, wave: 'triangle' },
    { from: 740, at: 0.22, length: 0.22, level: 0.3, wave: 'triangle' },
  ],
  /** The doors close for the day. */
  close: [
    { from: 784, at: 0, length: 0.3, level: 0.3 },
    { from: 587, at: 0.16, length: 0.3, level: 0.3 },
    { from: 392, at: 0.32, length: 0.6, level: 0.3 },
  ],
  /** Something goes into the basket at the shop. */
  buy: [
    { from: 1319, at: 0, length: 0.08, level: 0.25, wave: 'triangle' },
    { from: 1976, at: 0.07, length: 0.08, level: 0.25, wave: 'triangle' },
    { from: 2637, at: 0.14, length: 0.3, level: 0.25, wave: 'triangle' },
  ],
  /** Something is put back on the shelf. */
  putBack: [{ from: 523, to: 392, at: 0, length: 0.16, level: 0.25 }],
  /** The day ended with a profit. */
  profit: [
    { from: 523, at: 0, length: 0.16, level: 0.3, wave: 'triangle' },
    { from: 659, at: 0.11, length: 0.16, level: 0.3, wave: 'triangle' },
    { from: 784, at: 0.22, length: 0.16, level: 0.3, wave: 'triangle' },
    { from: 1047, at: 0.33, length: 0.5, level: 0.3, wave: 'triangle' },
  ],
  /** The day ended with a loss. */
  loss: [
    { from: 392, at: 0, length: 0.22, level: 0.3 },
    { from: 330, at: 0.18, length: 0.22, level: 0.3 },
    { from: 262, at: 0.36, length: 0.6, level: 0.3 },
  ],
  /** A star lands on the certificate. */
  star: [
    { from: 1175, at: 0, length: 0.12, level: 0.25, wave: 'triangle' },
    { from: 1760, at: 0.07, length: 0.4, level: 0.25, wave: 'triangle' },
  ],
  /** A coin drops into the till. */
  coin: [
    { from: 1976, at: 0, length: 0.07, level: 0.16, wave: 'triangle' },
    { from: 2637, at: 0.05, length: 0.16, level: 0.16, wave: 'triangle' },
  ],
  /** The printer feeds out one line of the receipt. */
  print: [{ from: 180, to: 140, at: 0, length: 0.05, level: 0.1, wave: 'square' }],
  /** The rolling door of the warung: a rattle of slats. */
  shutter: [
    { from: 95, at: 0, length: 0.07, level: 0.14, wave: 'square' },
    { from: 110, at: 0.08, length: 0.07, level: 0.14, wave: 'square' },
    { from: 90, at: 0.16, length: 0.07, level: 0.14, wave: 'square' },
    { from: 120, at: 0.24, length: 0.07, level: 0.14, wave: 'square' },
    { from: 85, at: 0.32, length: 0.07, level: 0.14, wave: 'square' },
    { from: 70, at: 0.4, length: 0.18, level: 0.18, wave: 'square' },
  ],
  /** Fourteen days survived. */
  win: [
    { from: 523, at: 0, length: 0.14, level: 0.3, wave: 'triangle' },
    { from: 659, at: 0.12, length: 0.14, level: 0.3, wave: 'triangle' },
    { from: 784, at: 0.24, length: 0.14, level: 0.3, wave: 'triangle' },
    { from: 1047, at: 0.36, length: 0.2, level: 0.3, wave: 'triangle' },
    { from: 784, at: 0.54, length: 0.12, level: 0.3, wave: 'triangle' },
    { from: 1047, at: 0.66, length: 0.8, level: 0.35, wave: 'triangle' },
  ],
};

/**
 * The same sound is not started again within this many seconds. At the
 * lunch peak several customers are served every second, and sped up four
 * times the till would only buzz; this way it rings now and then instead.
 */
const MIN_GAP = { sale: 0.3, renege: 0.4, balk: 0.4, soldOut: 0.6, coin: 0.05, print: 0.04 };
const DEFAULT_GAP = 0.09;

/** How long after being asked a sound may still start, in seconds, when the audio had to be woken first. */
const LATEST_START = 0.4;

let context = null;
/** Everything is played through here: one volume, and a limiter so that notes sounding together cannot distort. */
let output = null;
let enabled = true;
const lastPlayed = new Map();

function audioContext() {
  if (context) return context;
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContext) return null;
  context = new AudioContext();

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  limiter.connect(context.destination);
  output = context.createGain();
  output.gain.value = 0.9;
  output.connect(limiter);
  return context;
}

export function soundEnabled() {
  return enabled;
}

export function setSoundEnabled(on) {
  enabled = Boolean(on);
}

/**
 * Opens the audio context. Browsers allow it only from a tap, a click, or a
 * key press, and differ in which of those count, so this is called on all of
 * them until it has worked.
 *
 * @returns {boolean} whether the audio is running
 */
export function unlockSound() {
  try {
    const audio = audioContext();
    if (!audio) return false;
    if (audio.state !== 'running') audio.resume().catch(() => {});
    return audio.state === 'running';
  } catch {
    return false;
  }
}

function sound(audio, name) {
  const now = audio.currentTime;
  if (now - (lastPlayed.get(name) ?? -1) < (MIN_GAP[name] ?? DEFAULT_GAP)) return;
  lastPlayed.set(name, now);

  for (const note of SOUNDS[name]) {
    const start = now + note.at;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = note.wave ?? 'sine';
    oscillator.frequency.setValueAtTime(note.from, start);
    if (note.to) oscillator.frequency.exponentialRampToValueAtTime(note.to, start + note.length);
    // A quick attack and a long fall, like something struck.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.level, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.length);
    oscillator.connect(gain).connect(output);
    oscillator.start(start);
    oscillator.stop(start + note.length + 0.02);
  }
}

/** @param {keyof typeof SOUNDS} name */
export function play(name) {
  if (!enabled) return;
  try {
    const audio = audioContext();
    if (!audio) return;
    if (audio.state === 'running') {
      sound(audio, name);
      return;
    }
    // Still asleep: wake it, and play only if it wakes at once. (Before the
    // user has touched the page it stays asleep, and a sound held back until
    // then would come out of nowhere.)
    const asked = performance.now();
    audio
      .resume()
      .then(() => {
        if (audio.state === 'running' && performance.now() - asked < LATEST_START * 1000) sound(audio, name);
      })
      .catch(() => {});
  } catch {
    // A sound that cannot be made is simply not made.
  }
}
