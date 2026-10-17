/**
 * Midday: the warung is open, and the day plays out on screen.
 *
 * What is shown is the day itself, not a replay of it: the simulation that
 * decides the day's result is advanced event by event while it is drawn.
 * Pausing, speeding up, or skipping changes only how fast it is watched.
 * The queue is the same either way, because every random number of the day
 * is fixed by the game's seed and the day number.
 *
 * One thing does depend on the watching: the tips. Customers who were served
 * at once sometimes leave a coin on the counter, and it counts only if the
 * player picks it up before it is gone (see tip-coins.js). Which customers
 * leave one is fixed like everything else; picking it up is the player's part.
 */

import { DAY, TIPS } from '../game/config.js';
import { EVENT_KIND } from '../game/events.js';
import { ARRIVAL_OUTCOME, EVENT } from '../sim/engine.js';
import { confirmDialog } from './controls.js';
import { h, icon } from './dom.js';
import { clock as clockText, compact, decimal, integer, rupiah } from './format.js';
import { bounce, flash, pop, prefersReducedMotion, roll, swapIn, tossCoin } from './motion.js';
import { avatar, gesture } from './pak-erlangga.js';
import { PHASE, phaseAt, phaseName, setPhase } from './phase.js';
import { createScenePlayer } from './scene-player.js';
import { play } from './sound.js';
import { EVENT_TEXT, pick } from './text.js';
import { createTipCoins } from './tip-coins.js';
import { startTour } from './tour.js';
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
/** After the first coin he is glad of every this many more. */
const TIPS_PER_CLAP = 6;
/** How long the first coin lies on the counter before he explains it: long enough to be seen landing. */
const GUIDE_DELAY_MS = 350;

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
  tip: ['clap', ['Rezeki!', 'Lumayan, buat jajan!', 'Tip masuk!']],
  tipMissed: ['scratch', ['Koinnya keburu hilang...']],
});

/** The wash of color over a count on the board when a customer is lost that way. */
const LOSS_TINT = Object.freeze({
  reneged: 'rgb(213 94 0 / 0.55)',
  rejected: 'rgb(230 159 0 / 0.5)',
  soldOut: 'rgb(107 124 147 / 0.6)',
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
  const { simulation, decisions, model, event, tips: jar } = activeDay;
  const maxServers = model.servers ?? Math.max(...model.staffSchedule.map((entry) => entry.servers));
  const reducedMotion = prefersReducedMotion();

  // --- The stage ------------------------------------------------------------

  const canvas = h('canvas', { class: 'stage__canvas', 'aria-hidden': 'true' });
  const clockValue = h('span', { class: 'stage__clock num', text: clockText(simulation.clock) });
  const phase = h('span', { class: 'chip', text: 'Pagi' });
  const progress = h('span', { class: 'stage__progress-fill' });
  const closedNote = h('p', { class: 'stage__closed', hidden: true }, [icon('moon'), 'Warung tutup. Menghitung kas…']);

  // --- Tips -------------------------------------------------------------------

  // The jar shows what has been picked up today, and explains the coins when pressed.
  const jarCoin = h('span', { class: 'tipjar__coin', 'aria-hidden': 'true' });
  const jarAmount = h('span', { class: 'tipjar__amount num', text: rupiah(0) });
  const jarButton = h('button', { type: 'button', class: 'tipjar', title: 'Cara memungut tip' }, [
    jarCoin,
    h('span', { class: 'tipjar__label', text: 'Tip' }),
    h('span', { class: 'tipjar__clip' }, jarAmount),
    h('span', { class: 'sr-only', text: ', terkumpul hari ini. Cara memungut tip' }),
    icon('info', 'icon tipjar__hint'),
  ]);
  const coinLayer = h('div', { class: 'stage__coins' });
  /** What the jar shows: a coin counts once it has landed in it. */
  let tipsLanded = 0;
  let tipsTaken = 0;
  let tipMissed = false;

  // --- Pak Erlangga, watching -------------------------------------------------

  // He stands in the corner of the scene and reacts to what he sees. It is
  // commentary only: everything he remarks on is also in the counts below.
  const host = avatar();
  const hostSays = h('span', { class: 'stage__say', 'data-shown': 'false' });
  const hostCorner = h('div', { class: 'stage__host', 'aria-hidden': 'true' }, [host, hostSays]);
  let lastRemark = -Infinity;
  let lastLoss = -Infinity;
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
    // The bubble grows out of him and shrinks back; a new remark simply takes over the old one.
    hostSays.dataset.shown = 'true';
    window.clearTimeout(remarkTimer);
    remarkTimer = window.setTimeout(() => {
      hostSays.dataset.shown = 'false';
    }, REMARK_SHOWN_MS);
  }

  /** The warung is open: he says so, and the pegawai behind the counter hop to it. */
  function greet() {
    remark('open', true);
    if (!reducedMotion) scene.greet();
  }

  /** What he makes of one event of the simulation. */
  function watch(record) {
    const lost =
      record.type === EVENT.RENEGE ||
      record.type === EVENT.SOLD_OUT ||
      (record.type === EVENT.ARRIVAL && record.outcome !== ARRIVAL_OUTCOME.SERVED && record.outcome !== ARRIVAL_OUTCOME.QUEUED);
    if (lost) {
      lastLoss = performance.now();
      // The count that has just gone up lights for a moment, in the color of
      // that ending: what happened in the scene and where it is counted. Not
      // at four times the speed, where it would never stop flickering.
      const which =
        record.type === EVENT.RENEGE ? 'reneged' : record.outcome === ARRIVAL_OUTCOME.REJECTED ? 'rejected' : 'soldOut';
      if (player.pace < 4) flash(tallies[which].element, LOSS_TINT[which]);
    }
    if (record.type === EVENT.DEPARTURE) {
      sales += 1;
      // He does not cheer while somebody is still walking off unserved.
      if (sales % SALES_PER_CLAP === 0 && performance.now() - lastLoss > REMARK_GAP_MS) remark('sales');
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
  // The speed chosen yesterday is the speed today starts at.
  const startPace = PACES.includes(store.prefs.pace) ? store.prefs.pace : 1;
  const paceInputs = PACES.map((pace) =>
    h('input', { type: 'radio', name: 'pace', id: `pace-${pace}`, value: pace, class: 'segmented__input', checked: pace === startPace }),
  );
  const paceLabel = (pace) => `${decimal(pace, pace < 1 ? 1 : 0)}×`;
  // The block of color under the chosen speed: it slides from the old choice to the new one.
  const paceThumb = h('span', { class: 'segmented__thumb', 'aria-hidden': 'true' });
  const movePaceThumb = (pace) => {
    paceThumb.style.transform = `translateX(${PACES.indexOf(pace) * 100}%)`;
  };
  movePaceThumb(startPace);
  const paceControl = h('fieldset', { class: 'segmented segmented--slide', style: `--choices: ${PACES.length}` }, [
    h('legend', { class: 'sr-only', text: 'Kecepatan' }),
    paceThumb,
    ...PACES.map((pace, i) => [paceInputs[i], h('label', { class: 'segmented__label', for: `pace-${pace}`, text: paceLabel(pace) })]),
  ]);
  const skipButton = h('button', { type: 'button', class: 'btn' }, [h('span', { text: 'Langsung ke laporan' }), icon('chevron-right')]);

  // --- Running totals -------------------------------------------------------

  // Chalked on a board under the scene, so the counts and what they count are seen together.
  const tally = (key, label, outOf) => {
    const value = h('span', { text: '0' });
    return {
      element: h('div', { class: `tally__item tally__item--${key}` }, [
        h('dt', {}, [h('span', { class: 'tally__dot', 'aria-hidden': 'true' }), label]),
        h('dd', { class: 'num' }, [value, outOf && h('span', { class: 'tally__of', text: `/${outOf}` })]),
      ]),
      value,
    };
  };
  const tallies = {
    arrivals: tally('arrivals', 'Datang'),
    served: tally('served', 'Dilayani'),
    reneged: tally('reneged', 'Batal antre'),
    rejected: tally('balked', 'Penuh'),
    soldOut: tally('soldout', 'Kehabisan'),
    stock: tally('stock', 'Sisa stok', integer(decisions.stock)),
    revenue: tally('revenue', 'Uang masuk'),
  };

  // --- Gauges ---------------------------------------------------------------

  // Two readings of the queue as it stands this instant, taken straight from
  // the engine's state: how many of the pegawai on duty are serving (the
  // utilization ρ at this moment), and how much patience the least patient
  // waiting customer has left. Nothing is estimated.
  const busyFill = h('span', { class: 'gauge__fill' });
  const busyValue = h('span', { class: 'gauge__value num' });
  const patienceFill = h('span', { class: 'gauge__fill' });
  const patienceValue = h('span', { class: 'gauge__value num' });
  const gauge = (label, fill, value) =>
    h('div', { class: 'gauge' }, [
      h('span', { class: 'gauge__label', text: label }),
      h('span', { class: 'gauge__bar', 'aria-hidden': 'true' }, fill),
      value,
    ]);
  const gauges = h('div', { class: 'gauges', 'aria-label': 'Keadaan warung saat ini' }, [
    gauge('Pegawai sibuk', busyFill, busyValue),
    gauge('Sabar terpendek', patienceFill, patienceValue),
  ]);

  function renderGauges(now) {
    const { staff, busyServers } = simulation;
    const rho = staff > 0 ? Math.min(busyServers / staff, 1) : 0;
    busyFill.style.transform = `scaleX(${rho})`;
    busyValue.textContent = `${integer(busyServers)} dari ${integer(staff)}`;
    gauges.dataset.busy = rho >= 1 ? 'full' : 'room';

    // The least patient of those waiting: the share of their own patience still left.
    let least = null;
    for (const customer of simulation.line.peek(simulation.line.length)) {
      if (!Number.isFinite(customer.patience)) continue;
      const left = Math.min(Math.max(1 - (now - customer.arrivalTime) / customer.patience, 0), 1);
      if (least === null || left < least) least = left;
    }
    patienceFill.style.transform = `scaleX(${least ?? 1})`;
    patienceValue.textContent = least === null ? 'tidak ada antrean' : `sisa ${integer(Math.round(least * 100))}%`;
    gauges.dataset.patience = least !== null && least < 0.25 ? 'low' : 'fine';
  }

  const scene = new WarungScene(canvas, {
    seats: decisions.seats,
    maxServers,
    priceLabel: `+${compact(decisions.price / 1000)} rb`,
    // On a rainy day it really rains.
    weather: event?.id === 'rain' ? 'rain' : null,
  });

  const coins = createTipCoins({
    layer: coinLayer,
    jar,
    scene,
    clock: () => player.clock,
    onTake(amount, from) {
      play('tip');
      tipsTaken += 1;
      if (tipsTaken === 1 || tipsTaken % TIPS_PER_CLAP === 0) remark('tip');
      // The coin is thrown to the jar, and is counted when it lands there.
      tossCoin(from, jarCoin, () => {
        tipsLanded += amount;
        jarAmount.textContent = rupiah(tipsLanded);
        roll(jarAmount, 1);
        bounce(jarButton);
      });
    },
    onMiss() {
      // He says it once; after that the empty spot on the counter says it.
      if (!tipMissed) remark('tipMissed');
      tipMissed = true;
    },
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
      play('surprise');
      if (event.id in REMARKS) remark(event.id, true);
    }
  }

  let lastHud = 0;
  /** False until the counts have been drawn once: what they start at is not a change. */
  let hudDrawn = false;
  let completed = false;
  let closingTimer = null;
  /** True while the rest of the day is being run at once: nothing of it is seen or heard. */
  let skipping = false;

  function renderHud() {
    revealEvent(player.clock);
    const { arrivals, served, reneged, rejected, soldOut } = simulation.results;
    const now = Math.min(player.clock, simulation.clock);
    clockValue.textContent = clockText(player.clock);
    renderGauges(now);
    const part = simulation.closed ? 'Tutup' : phaseName(now);
    if (part !== phase.textContent) {
      // The part of the day turns over five times: each time the chip says so.
      phase.textContent = part;
      if (hudDrawn) pop(phase);
    }
    hudDrawn = true;
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
    const label = player.playing ? 'Jeda' : 'Putar';
    const changed = playLabel.textContent !== '' && playLabel.textContent !== label;
    const mark = icon(player.playing ? 'pause' : 'play');
    playButton.replaceChildren(mark, playLabel);
    playLabel.textContent = label;
    if (changed) swapIn(mark);
    // A paused day keeps its coins where they are, out of reach.
    coins.setFrozen(!player.playing);
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
      // What is skipped is neither heard nor remarked on, and leaves no coin to pick up.
      if (skipping) return;
      const sound = soundOf(record);
      if (sound) play(sound);
      watch(record);
      if (record.type === EVENT.DEPARTURE) {
        const coin = jar.leave(record.customer, record.time);
        if (coin) {
          coins.drop(coin, record.serverIndex);
          // The first coin ever: he explains it while it lies there, once it has landed.
          if (!store.prefs.tipTourSeen && guideTimer === null) guideTimer = window.setTimeout(() => showTipGuide(), GUIDE_DELAY_MS);
        }
      }
    },
    onFrame: () => {
      coins.frame();
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
      if (!input.checked) return;
      player.setPace(Number(input.value));
      movePaceThumb(Number(input.value));
      store.setPrefs({ pace: Number(input.value) });
    }),
  );
  skipButton.addEventListener('click', async () => {
    // Coins lying on the counter would be left behind: said before they are.
    if (coins.count > 0 && !simulation.finished) {
      const wasPlaying = player.playing;
      player.pause();
      renderPlayButton();
      const agreed = await confirmDialog({
        title: 'Tinggalkan koinnya?',
        body: `Masih ada ${coins.count} koin tip di konter. Kalau langsung ke laporan, koin itu hangus.`,
        confirmLabel: 'Ke laporan',
        cancelLabel: 'Pungut dulu',
      });
      if (!agreed) {
        if (wasPlaying) player.play();
        renderPlayButton();
        return;
      }
    }
    if (completed) return;
    skipping = true;
    // The coins still on the counter are left behind with the rest of the day.
    coins.clear();
    player.skip();
    complete();
  });

  /**
   * On a wide screen the whole day fits the window: the scene gives up
   * height until the clock above it and the legend below it are both in
   * sight. A phone scrolls anyway, and keeps the scene as tall as it is wide.
   */
  function fitWindow() {
    const view = canvas.closest('.view');
    if (!view) return;
    if (window.innerWidth < 760) {
      scene.limitHeight(360);
      return;
    }
    const around = view.getBoundingClientRect().bottom + window.scrollY - canvas.clientHeight;
    scene.limitHeight(window.innerHeight - around);
  }

  const observer = new ResizeObserver(() => {
    fitWindow();
    scene.resize();
    player.redraw();
    coins.reposition();
  });
  window.addEventListener('resize', fitWindow);

  // T picks up the coin that has lain longest: the same one press per coin, without having to aim.
  function onKey(event) {
    if (event.key.toLowerCase() !== 't' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    if (coins.takeOldest()) event.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  // --- The guide to the coins ---------------------------------------------------

  let tour = null;
  let guideTimer = null;

  /**
   * Pak Erlangga explains the coins, pointing at one: the first coin a
   * customer leaves, the first time, and a sample when he is asked again
   * with the counter empty. The day waits while he does, and goes on
   * afterwards if it was running.
   */
  function showTipGuide({ thenPlay = player.playing } = {}) {
    if (tour || completed || simulation.finished) return;
    player.pause();
    renderPlayButton();
    const sample = coins.point() ?? coins.sample();
    const withKeys = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    tour = startTour(
      [
        {
          target: sample.element,
          title: 'Koin tip',
          text:
            `Pelanggan yang langsung dilayani kadang meninggalkan koin ${rupiah(TIPS.amount)} di konter. ` +
            `Pencet sebelum cincinnya habis${withKeys ? ', atau tekan T' : ''}. ` +
            'Selagi dijeda koin tidak bisa dipungut, dan kalau harinya dilewati koinnya hangus.',
        },
      ],
      {
        onEnd: () => {
          tour = null;
          sample.remove();
          store.setPrefs({ tipTourSeen: true });
          if (thenPlay && !simulation.finished) player.play();
          renderPlayButton();
          jarButton.focus({ preventScroll: true });
        },
      },
    );
  }
  jarButton.addEventListener('click', () => showTipGuide());

  // --- Page -----------------------------------------------------------------

  const heading = h('h1', { id: 'view-title', tabindex: '-1', text: 'Warung sedang buka' });
  const legendItem = (className, text) =>
    h('span', { class: 'legend__item' }, [h('span', { class: `legend__swatch ${className}`, 'aria-hidden': 'true' }), text]);
  const controls = h('div', { class: 'stage__controls' }, [playButton, paceControl, skipButton]);

  container.append(
    h('section', { class: 'view view--siang', 'aria-labelledby': 'view-title' }, [
      h('header', { class: 'view__head' }, heading),
      h('div', { class: 'stage stage--day' }, [
        h('div', { class: 'stage__top' }, [
          h('div', { class: 'stage__time' }, [h('span', { class: 'sr-only', text: 'Jam ' }), clockValue, phase]),
          h('div', { class: 'stage__progress', 'aria-hidden': 'true' }, progress),
          jarButton,
        ]),
        h('div', { class: 'stage__frame' }, [
          // The day's event is pinned over the sky, in sight when it strikes.
          h('div', { class: 'stage__view' }, [canvas, coinLayer, banner, hostCorner, closedNote]),
          gauges,
          h('dl', { class: 'tally', 'aria-label': 'Hitungan sejauh ini' }, Object.values(tallies).map((item) => item.element)),
        ]),
        controls,
        h('p', { class: 'legend legend--center' }, [
          legendItem('legend__swatch--tip', 'koin di konter: pencet untuk memungut tip'),
          legendItem('legend__swatch--patience', 'batang di atas kepala: sisa kesabaran'),
          legendItem('legend__swatch--ring', 'cincin: sedang dilayani'),
          legendItem('legend__swatch--angry', 'batal antre karena kelamaan'),
          legendItem('legend__swatch--full', 'pulang karena bangku penuh'),
        ]),
      ]),
      reducedMotion &&
        h('p', { class: 'notice' }, [
          icon('info'),
          'Animasi dijeda karena perangkatmu diatur untuk mengurangi gerakan. Tekan Putar untuk menontonnya, atau langsung buka laporannya.',
        ]),
    ]),
  );

  observer.observe(canvas);
  scene.resize();
  fitWindow();
  player.setPace(startPace);
  player.start();
  if (!reducedMotion && !simulation.finished) player.play();
  renderPlayButton();
  renderHud();
  play('open');
  // He greets the day once the rolling door is up.
  const greeting = window.setTimeout(() => greet(), 1300);

  return {
    heading,
    destroy() {
      window.clearTimeout(closingTimer);
      window.clearTimeout(remarkTimer);
      window.clearTimeout(greeting);
      window.clearTimeout(guideTimer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fitWindow);
      tour?.close();
      observer.disconnect();
      player.stop();
    },
  };
}
