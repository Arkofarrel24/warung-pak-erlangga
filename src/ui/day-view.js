/**
 * Midday: the warung is open, and the day plays out on screen.
 *
 * What is shown is the day itself, not a replay of it: the simulation that
 * decides the day's result is advanced event by event while it is drawn.
 * Pausing, speeding up, or skipping changes only how fast it is watched.
 * The result is the same either way, because every random number of the day
 * is fixed by the game's seed and the day number.
 */

import { DAY } from '../game/config.js';
import { EVENT_KIND } from '../game/events.js';
import { ARRIVAL_OUTCOME, EVENT } from '../sim/engine.js';
import { h, icon } from './dom.js';
import { clock as clockText, compact, decimal, integer, rupiah } from './format.js';
import { pop, prefersReducedMotion } from './motion.js';
import { avatar, gesture } from './pak-erlangga.js';
import { PHASE, phaseAt, phaseName, setPhase } from './phase.js';
import { createScenePlayer } from './scene-player.js';
import { play } from './sound.js';
import { EVENT_TEXT, pick } from './text.js';
import { WarungScene } from './warung-scene.js';

/** At normal speed an hour of the day takes six seconds, a whole day a little over a minute. */
const HOURS_PER_SECOND = 1 / 6;
const PACES = [0.5, 1, 2, 4];
const HUD_INTERVAL_MS = 120;
/** How long the closed warung stays on screen before the report opens. */
const CLOSING_PAUSE_MS = 1300;

/** Pak Erlangga does not comment on everything: at least this long between two remarks, in milliseconds. */
const REMARK_GAP_MS = 3500;
const REMARK_SHOWN_MS = 2400;
/** He claps once for every this many portions sold. */
const SALES_PER_CLAP = 12;

/** What he says, and does, about what happens at the warung while he watches. */
const REMARKS = Object.freeze({
  open: ['wave', ['Selamat berjualan!', 'Ayo, buka!']],
  sales: ['clap', ['Laris manis!', 'Nah, begitu!', 'Dapurnya ngebul!']],
  renege: ['scratch', ['Waduh, ada yang pulang...', 'Kelamaan, ya?', 'Aduh, antreannya...']],
  full: ['shake', ['Bangkunya penuh!', 'Tidak kebagian tempat...']],
  soldOut: ['shake', ['Habis! Besok masak lebih banyak.']],
  group: ['wave', ['Wah, rombongan!']],
  close: ['wave', ['Tutup dulu, ya!']],
  staffSick: ['scratch', ['Kurang satu orang...']],
  gasOut: ['scratch', ['Gasnya habis...']],
  viral: ['cheer', ['Warungnya viral!']],
  helper: ['cheer', ['Keponakan saya datang!']],
});

/** What is heard when the engine processes an event, if anything. */
function soundOf(record) {
  if (record.type === EVENT.DEPARTURE) return 'sale';
  if (record.type === EVENT.RENEGE) return 'renege';
  if (record.type === EVENT.BATCH_ARRIVAL) return 'group';
  if (record.type === EVENT.CLOSE) return 'close';
  if (record.type === EVENT.ARRIVAL && record.outcome === ARRIVAL_OUTCOME.REJECTED) return 'balk';
  if (record.type === EVENT.ARRIVAL && record.outcome === ARRIVAL_OUTCOME.SOLD_OUT) return 'soldOut';
  return null;
}

/**
 * When the day's event becomes known to the player: news from the moment the
 * warung opens (it was read in the morning), a surprise at the moment it strikes.
 */
function revealTime(event) {
  if (event.kind === EVENT_KIND.NEWS) return 0;
  return event.time ?? 0;
}

export function renderDay(container, { store, activeDay, completeDay }) {
  const { game } = store;
  const { simulation, decisions, model, event } = activeDay;
  const maxServers = model.servers ?? Math.max(...model.staffSchedule.map((entry) => entry.servers));
  const reducedMotion = prefersReducedMotion();

  // --- The stage ------------------------------------------------------------

  const canvas = h('canvas', { class: 'stage__canvas', 'aria-hidden': 'true' });
  const clockValue = h('span', { class: 'stage__clock num', text: clockText(simulation.clock) });
  const phase = h('span', { class: 'chip', text: 'Pagi' });
  const progress = h('span', { class: 'stage__progress-fill' });
  const closedNote = h('p', { class: 'stage__closed', hidden: true }, [icon('moon'), 'Warung tutup. Menghitung kas…']);

  // --- Pak Erlangga, watching -------------------------------------------------

  // He stands in the corner of the scene and reacts to what he sees. It is
  // commentary only: everything he remarks on is also in the counts below.
  const host = avatar();
  const hostSays = h('span', { class: 'stage__say', hidden: true });
  const hostCorner = h('div', { class: 'stage__host', 'aria-hidden': 'true' }, [host, hostSays]);
  let lastRemark = -Infinity;
  let remarkTimer = null;
  let sales = 0;

  /** @param {boolean} [always] said even if he has only just spoken */
  function remark(about, always = false) {
    const now = performance.now();
    if (reducedMotion || (!always && now - lastRemark < REMARK_GAP_MS)) return;
    lastRemark = now;
    const [how, lines] = REMARKS[about];
    gesture(host, how);
    hostSays.textContent = pick(lines, hostSays.textContent);
    hostSays.hidden = false;
    pop(hostSays);
    window.clearTimeout(remarkTimer);
    remarkTimer = window.setTimeout(() => {
      hostSays.hidden = true;
    }, REMARK_SHOWN_MS);
  }

  /** What he makes of one event of the simulation. */
  function watch(record) {
    if (record.type === EVENT.DEPARTURE) {
      sales += 1;
      if (sales % SALES_PER_CLAP === 0) remark('sales');
    } else if (record.type === EVENT.RENEGE) remark('renege');
    else if (record.type === EVENT.BATCH_ARRIVAL) remark('group', true);
    else if (record.type === EVENT.CLOSE) remark('close', true);
    else if (record.type === EVENT.SOLD_OUT) remark('soldOut', true);
    else if (record.type === EVENT.ARRIVAL && record.outcome === ARRIVAL_OUTCOME.REJECTED) remark('full');
    else if (record.type === EVENT.ARRIVAL && record.outcome === ARRIVAL_OUTCOME.SOLD_OUT) remark('soldOut');
  }

  // --- Controls -------------------------------------------------------------

  const playLabel = h('span');
  const playButton = h('button', { type: 'button', class: 'btn' }, [playLabel]);
  const paceInputs = PACES.map((pace) =>
    h('input', { type: 'radio', name: 'pace', id: `pace-${pace}`, value: pace, class: 'segmented__input', checked: pace === 1 }),
  );
  const paceLabel = (pace) => `${decimal(pace, pace < 1 ? 1 : 0)}×`;
  const paceControl = h('fieldset', { class: 'segmented' }, [
    h('legend', { class: 'sr-only', text: 'Kecepatan' }),
    ...PACES.map((pace, i) => [paceInputs[i], h('label', { class: 'segmented__label', for: `pace-${pace}`, text: paceLabel(pace) })]),
  ]);
  const skipButton = h('button', { type: 'button', class: 'btn' }, [h('span', { text: 'Langsung ke laporan' }), icon('chevron-right')]);

  // --- Running totals -------------------------------------------------------

  const tally = (key, label, note) => {
    const value = h('dd', { class: 'num', text: '0' });
    return { element: h('div', { class: `tally__item tally__item--${key}` }, [h('dt', {}, [h('span', { class: 'tally__dot', 'aria-hidden': 'true' }), label]), value, note && h('small', { text: note })]), value };
  };
  const tallies = {
    arrivals: tally('arrivals', 'Datang', 'pelanggan'),
    served: tally('served', 'Dilayani', 'porsi terjual'),
    reneged: tally('reneged', 'Batal antre', 'habis sabar'),
    rejected: tally('balked', 'Penuh', 'tak dapat bangku'),
    soldOut: tally('soldout', 'Kehabisan', 'stok habis'),
    stock: tally('stock', 'Sisa stok', `dari ${integer(decisions.stock)} porsi`),
    revenue: tally('revenue', 'Uang masuk', 'hari ini'),
  };

  const scene = new WarungScene(canvas, {
    seats: decisions.seats,
    maxServers,
    priceLabel: `+${compact(decisions.price / 1000)} rb`,
    // On a rainy day it really rains.
    weather: event?.id === 'rain' ? 'rain' : null,
  });

  // --- The day's event --------------------------------------------------------

  const banner = h('p', { class: 'happened', role: 'status', hidden: true });
  let revealed = false;

  /** Shows the event once the clock on screen has reached it. */
  function revealEvent(now) {
    if (!event || revealed || now < revealTime(event)) return;
    revealed = true;
    const text = EVENT_TEXT[event.id];
    const surprise = event.kind === EVENT_KIND.SURPRISE;
    banner.className = surprise ? 'happened happened--surprise' : 'happened';
    banner.replaceChildren(
      h('strong', { class: 'happened__title' }, [
        h('span', { class: 'happened__icon' }, icon(text.icon)),
        `${surprise ? 'Kejutan' : 'Kabar pagi'}: ${text.name}`,
      ]),
      h('span', { class: 'happened__text', text: surprise ? text.struck(event) : text.happened(event) }),
    );
    banner.hidden = false;
    if (surprise) {
      pop(banner);
      play('surprise');
      if (event.id in REMARKS) remark(event.id, true);
    }
  }

  let lastHud = 0;
  let completed = false;
  let closingTimer = null;
  /** True while the rest of the day is being run at once: nothing of it is seen or heard. */
  let skipping = false;

  function renderHud() {
    revealEvent(player.clock);
    const { arrivals, served, reneged, rejected, soldOut } = simulation.results;
    const now = Math.min(player.clock, simulation.clock);
    clockValue.textContent = clockText(player.clock);
    phase.textContent = simulation.closed ? 'Tutup' : phaseName(now);
    // The header takes the light of the hour on the clock.
    setPhase(simulation.closed ? PHASE.NIGHT : phaseAt(now));
    progress.style.transform = `scaleX(${Math.min(player.clock / DAY.hours, 1)})`;
    tallies.arrivals.value.textContent = integer(arrivals);
    tallies.served.value.textContent = integer(served);
    tallies.reneged.value.textContent = integer(reneged);
    tallies.rejected.value.textContent = integer(rejected);
    tallies.soldOut.value.textContent = integer(soldOut);
    tallies.stock.value.textContent = integer(simulation.stock);
    tallies.revenue.value.textContent = rupiah(served * decisions.price);
  }

  function renderPlayButton() {
    playButton.replaceChildren(icon(player.playing ? 'pause' : 'play'), playLabel);
    playLabel.textContent = player.playing ? 'Jeda' : 'Putar';
  }

  function complete() {
    if (completed) return;
    completed = true;
    window.clearTimeout(closingTimer);
    completeDay();
  }

  const player = createScenePlayer({
    simulation,
    scene,
    hoursPerSecond: HOURS_PER_SECOND,
    onRecord: (record) => {
      // What is skipped is neither heard nor remarked on.
      if (skipping) return;
      const sound = soundOf(record);
      if (sound) play(sound);
      watch(record);
    },
    onFrame: () => {
      const now = performance.now();
      if (now - lastHud < HUD_INTERVAL_MS) return;
      lastHud = now;
      renderHud();
    },
    onEnd: () => {
      renderHud();
      closedNote.hidden = false;
      playButton.disabled = true;
      // The closed warung is left on screen for a moment, then the report opens.
      closingTimer = window.setTimeout(complete, reducedMotion ? 0 : CLOSING_PAUSE_MS);
    },
  });

  playButton.addEventListener('click', () => {
    if (player.playing) player.pause();
    else player.play();
    renderPlayButton();
  });
  paceInputs.forEach((input) =>
    input.addEventListener('change', () => {
      if (input.checked) player.setPace(Number(input.value));
    }),
  );
  skipButton.addEventListener('click', () => {
    skipping = true;
    player.skip();
    complete();
  });

  const observer = new ResizeObserver(() => {
    scene.resize();
    player.redraw();
  });

  // --- Page -----------------------------------------------------------------

  const heading = h('h1', { id: 'view-title', tabindex: '-1', text: 'Warung sedang buka' });
  const legendItem = (className, text) =>
    h('span', { class: 'legend__item' }, [h('span', { class: `legend__swatch ${className}`, 'aria-hidden': 'true' }), text]);

  container.append(
    h('section', { class: 'view view--siang', 'aria-labelledby': 'view-title' }, [
      h('header', { class: 'view__head' }, [
        h('p', { class: 'eyebrow' }, [icon('shop'), `Hari ${game.day} dari ${DAY.count} · Siang`]),
        heading,
      ]),
      h('div', { class: 'stage stage--day' }, [
        h('div', { class: 'stage__top' }, [
          h('div', { class: 'stage__time' }, [h('span', { class: 'sr-only', text: 'Jam ' }), clockValue, phase]),
          h('div', { class: 'stage__progress', 'aria-hidden': 'true' }, progress),
        ]),
        h('div', { class: 'stage__frame' }, [canvas, hostCorner, closedNote]),
        h('div', { class: 'stage__controls' }, [playButton, paceControl, skipButton]),
        h('p', { class: 'legend legend--center' }, [
          legendItem('legend__swatch--patience', 'batang di atas kepala: sisa kesabaran'),
          legendItem('legend__swatch--ring', 'cincin: sedang dilayani'),
          legendItem('legend__swatch--angry', 'batal antre karena kelamaan'),
          legendItem('legend__swatch--full', 'pulang karena bangku penuh'),
        ]),
      ]),
      banner,
      reducedMotion &&
        h('p', { class: 'notice' }, [
          icon('info'),
          'Animasi dijeda karena perangkatmu diatur untuk mengurangi gerakan. Tekan Putar untuk menontonnya, atau langsung buka laporannya.',
        ]),
      h('dl', { class: 'tally', 'aria-label': 'Hitungan sejauh ini' }, Object.values(tallies).map((item) => item.element)),
    ]),
  );

  observer.observe(canvas);
  scene.resize();
  player.start();
  if (!reducedMotion && !simulation.finished) player.play();
  renderPlayButton();
  renderHud();
  play('open');
  // He greets the day once the rolling door is up.
  const greeting = window.setTimeout(() => remark('open', true), 1300);

  return {
    heading,
    destroy() {
      window.clearTimeout(closingTimer);
      window.clearTimeout(remarkTimer);
      window.clearTimeout(greeting);
      observer.disconnect();
      player.stop();
    },
  };
}
