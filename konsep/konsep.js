/**
 * A redesign concept for Warung Pak Erlangga: "one stall, three times of day".
 *
 * This is a second front-end on the game's own rules and engine, not a
 * mock-up: the day that plays here is the day startDay() sets up, simulated
 * by the same discrete-event engine and settled by the same books. Only how
 * it is shown is different.
 *
 *   - The warung is always on screen. In the morning it shows the stall the
 *     choices describe (three pegawai is three people behind the counter),
 *     at midday it shows the simulation as it runs, at night it is closed.
 *   - Everything read or pressed is on one panel beside it.
 *
 * What the concept leaves out, to stay a concept: the shop next door, shift
 * schedules, the guided tour, the charts, sound, and saving. Nothing is
 * stored; a reload starts over.
 */

import { DAY, DEMAND, LIMITS, SERVICE, START } from '../src/game/config.js';
import { EVENT_KIND } from '../src/game/events.js';
import { checkDecisions, defaultDecisions, newGame, stars, startDay, STATUS } from '../src/game/game.js';
import { ARRIVAL_OUTCOME, EVENT, QueueSimulation } from '../src/sim/engine.js';
import { h, svg } from '../src/ui/dom.js';
import { draftFacts } from '../src/ui/draft.js';
import { clock as clockText, compact, decimal, hourRange, hourTick, integer, percent, rupiah, shortRupiah } from '../src/ui/format.js';
import { prefersReducedMotion, roll } from '../src/ui/motion.js';
import { avatar } from '../src/ui/pak-erlangga.js';
import { createScenePlayer } from '../src/ui/scene-player.js';
import { EVENT_TEXT } from '../src/ui/text.js';
import { WarungScene } from '../src/ui/warung-scene.js';
import { dayFindings } from '../src/ui/why-view.js';

/** At normal speed an hour of the day takes six seconds, as in the game. */
const HOURS_PER_SECOND = 1 / 6;
const PACES = [0.5, 1, 2, 4];
const HUD_INTERVAL_MS = 120;
/** How long the closed warung stays on screen before the evening's panel takes over. */
const CLOSING_PAUSE_MS = 1100;
/** Hours since opening the stall is lit by on the two screens where no day is running. */
const MORNING_LIGHT = 0.4;
const NIGHT_LIGHT = 13.4;

const reducedMotion = prefersReducedMotion();
const ic = (name) => h('i', { class: `ph-bold ph-${name}`, 'aria-hidden': 'true' });

// --- State: all of it in memory -----------------------------------------------------

const app = {
  screen: 'home',
  /** The game as the rules know it, or null before one is started. */
  game: null,
  /** The morning's choices being worked on. */
  draft: null,
  /** The day in progress: what startDay() returned. */
  day: null,
  /** The report of the day that has just ended. */
  report: null,
};

const panel = document.getElementById('panel');
const stageFoot = document.getElementById('stage-foot');
const canvas = document.getElementById('canvas');
const scene = new WarungScene(canvas, { seats: START.seats, maxServers: START.staff });

// --- The stage: one scene, shown in three ways -----------------------------------------

/** Stops whatever is drawing the scene now, and redraws it once (after a resize). */
let stage = { stop() {}, redraw() {} };

/** The stall standing still: the pegawai and stools the choices describe, or closed for the night. */
function showStall({ staff, seats, light, closed = false }) {
  stage.stop();
  scene.configure({ seats, maxServers: staff });
  // What the scene needs to know of a simulation, for a stall nobody has come to yet.
  const empty = { servers: Array(staff).fill(null), line: { peek: () => [] }, staff: closed ? 0 : staff, stock: 1 };
  const view = { clock: 0, dayHour: light, pace: 1, closed };
  scene.sync(empty, false);
  scene.draw(0, view);

  let frameId = null;
  let last = performance.now();
  const frame = (now) => {
    frameId = window.requestAnimationFrame(frame);
    scene.draw(Math.min((now - last) / 1000, 0.1), view);
    last = now;
  };
  // The street stays alive (the palm, the cat, what passes by) unless motion is unwanted.
  if (!reducedMotion) frameId = window.requestAnimationFrame(frame);
  stage = {
    stop: () => window.cancelAnimationFrame(frameId),
    redraw: () => {
      scene.sync(empty, false);
      scene.draw(0, view);
    },
  };
}

/** A simulation running in the scene. Returns the player that drives it. */
function showRunning(simulation, { seats, staff, price, weather = null, ...callbacks }) {
  stage.stop();
  scene.configure({ seats, maxServers: staff, priceLabel: `+${compact(price / 1000)} rb`, weather });
  const player = createScenePlayer({ simulation, scene, hoursPerSecond: HOURS_PER_SECOND, ...callbacks });
  player.start();
  if (!reducedMotion) player.play();
  stage = { stop: () => player.stop(), redraw: () => player.redraw() };
  return player;
}

new ResizeObserver(() => {
  scene.resize();
  stage.redraw();
}).observe(canvas);

// --- Small pieces ---------------------------------------------------------------------

/** Puts a screen's content in the panel, each block arriving a moment after the one before. */
function mount(className, children) {
  panel.className = `panel ${className}`;
  panel.replaceChildren(...children.filter(Boolean));
  [...panel.children].forEach((child, i) => child.style.setProperty('--i', String(i)));
}

const foot = (...children) => stageFoot.replaceChildren(...children);
const underStage = document.getElementById('under');
const under = (...children) => underStage.replaceChildren(...children.filter(Boolean));

/**
 * Arrivals per hour as bars, with the capacity c·μ drawn across them as a
 * dashed line. An hour whose bar rises above the line had more customers
 * than the pegawai could serve, and is drawn in the color of a loss.
 *
 * @param {number[]} arrivals one count per opening hour (all zero when there is no day to show yet)
 * @param {number} capacity customers the pegawai can serve in an hour
 */
function hourChart(arrivals, capacity) {
  const width = 640;
  const height = 150;
  const left = 34;
  const bottom = 24;
  const top = 12;
  const slot = (width - left) / arrivals.length;
  const peak = Math.max(...arrivals, capacity, 1) * (Math.max(...arrivals) > 0 ? 1.1 : 1.5);
  const y = (value) => top + (height - top - bottom) * (1 - value / peak);
  const tick = (x, yy, text, anchor) => svg('text', { class: 'chart__tick', x, y: yy, 'text-anchor': anchor, text });
  return svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false' }, [
    svg('line', { class: 'chart__base', x1: left, x2: width, y1: y(0), y2: y(0) }),
    ...arrivals.map((count, hour) =>
      svg('rect', {
        class: count > capacity ? 'chart__bar chart__bar--over' : 'chart__bar',
        x: left + hour * slot + 4,
        y: y(count),
        width: slot - 8,
        height: Math.max(y(0) - y(count), 0),
        rx: 3,
      }),
    ),
    svg('line', { class: 'chart__line', x1: left, x2: width, y1: y(capacity), y2: y(capacity) }),
    tick(left - 8, y(capacity) + 4, compact(capacity, 0), 'end'),
    tick(left - 8, y(0) + 4, '0', 'end'),
    ...arrivals.map((_, hour) => (hour % 2 === 0 ? tick(left + hour * slot + slot / 2, height - 6, hourTick(hour), 'middle') : null)),
  ]);
}

/** The chart with its heading and one sentence that reads it. */
function hours(title, arrivals, capacity, reading) {
  return h('figure', { class: 'hours' }, [h('figcaption', { text: title }), hourChart(arrivals, capacity), h('p', {}, reading)]);
}
const live = (text) => h('span', { class: 'live', text });

/** What Pak Erlangga says: his portrait and a line or two. */
function says(children, mood) {
  return h('div', { class: 'says' }, [avatar({ mood }), h('p', {}, children)]);
}

/** A number with a minus and a plus. */
function stepper({ name, value, min, max, step = 1, format = integer, onChange }) {
  let current = value;
  let upper = max;
  const output = h('output', { class: 'stepper__value num' });
  const minus = h('button', { type: 'button', class: 'stepper__btn', 'aria-label': `Kurangi ${name}` }, ic('minus'));
  const plus = h('button', { type: 'button', class: 'stepper__btn', 'aria-label': `Tambah ${name}` }, ic('plus'));
  const draw = () => {
    output.textContent = format(current);
    minus.disabled = current <= min;
    plus.disabled = current >= upper;
  };
  const set = (next, direction) => {
    const clamped = Math.min(Math.max(next, min), upper);
    if (clamped === current) return;
    current = clamped;
    draw();
    roll(output, direction);
    onChange(current);
  };
  minus.addEventListener('click', () => set(current - step, -1));
  plus.addEventListener('click', () => set(current + step, 1));
  draw();
  return {
    element: h('div', { class: 'stepper', role: 'group', 'aria-label': name }, [minus, output, plus]),
    /** Moves the upper limit; the value itself is left where it is. */
    setMax(next) {
      upper = Math.max(next, current, min);
      draw();
    },
  };
}

// --- The bar and the fourteen days -------------------------------------------------------

function renderChrome() {
  const { game, screen } = app;
  const parts = [
    ['morning', 'Pagi'],
    ['day', 'Siang'],
    ['night', 'Malam'],
  ];
  document.getElementById('track').replaceChildren(
    ...parts.map(([id, label]) => h('li', { 'aria-current': id === screen ? 'step' : null, text: label })),
  );

  const stat = (label, value) => h('div', {}, [h('dt', { text: label }), h('dd', { text: value })]);
  document.getElementById('stats').replaceChildren(
    ...(game
      ? [
          stat('Hari', `${Math.min(game.day, DAY.count)}/${DAY.count}`),
          stat('Kas', shortRupiah(game.cash)),
          stat('Reputasi', decimal(game.reputation, 0)),
        ]
      : []),
  );

  document.getElementById('days').replaceChildren(
    ...Array.from({ length: DAY.count }, (_, i) => {
      const report = game?.history[i];
      const today = game?.status === STATUS.PLAYING && game.day === i + 1;
      const result = report ? (report.ledger.profit >= 0 ? 'gain' : 'loss') : null;
      const said = report
        ? `Hari ${i + 1}: ${result === 'gain' ? 'untung' : 'rugi'} ${rupiah(Math.abs(report.ledger.profit))}`
        : `Hari ${i + 1}${today ? ': hari ini' : ''}`;
      return h('li', { 'data-result': result, 'aria-current': today ? 'true' : null, 'aria-label': said, title: said });
    }),
  );
  document.getElementById('acts').hidden = screen !== 'home';
  // The fourteen days mean something only once a game is under way.
  document.getElementById('days').hidden = !game || screen === 'home';
}

// --- The front -------------------------------------------------------------------------

function renderHome() {
  // The game's engine running a warung like the one about to be taken over, without end.
  const simulation = new QueueSimulation({
    arrivalRate: 23,
    serviceRate: SERVICE.baseRate,
    servers: START.staff,
    waitingRoom: 3,
    patienceRate: SERVICE.basePatienceRate,
    duration: 1e9,
    seed: 20_261_006,
  });
  while (simulation.fel.peek().time < 2) simulation.step();
  showRunning(simulation, { seats: 3, staff: START.staff, price: START.price, dayHour: (clock) => clock % 14.5 });
  foot(h('span', { text: 'Ini bukan video. Mesin simulasinya sedang berjalan.' }));
  under();

  const playing = app.game?.status === STATUS.PLAYING;
  mount('panel--home', [
    h('h1', { text: `Kelola warung ${DAY.count} hari.` }),
    h('p', {
      class: 'panel__lead',
      text: 'Atur pegawai, harga, stok, dan bangku. Antreannya dijalankan mesin simulasi sungguhan, pelanggan demi pelanggan.',
    }),
    h('div', { class: 'actions' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--main',
          onclick: () => {
            if (!playing) startGame();
            go('morning');
          },
        },
        [ic('play'), playing ? `Lanjutkan hari ke-${app.game.day}` : 'Mulai kelola warung'],
      ),
    ]),
  ]);
}

function startGame() {
  let seed;
  try {
    seed = window.crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    seed = Math.floor(Math.random() * 2 ** 32);
  }
  app.game = newGame(seed);
  app.draft = null;
  app.report = null;
}

// --- Morning ---------------------------------------------------------------------------

function renderMorning() {
  const { game } = app;
  const yesterday = game.history.at(-1) ?? null;
  if (!app.draft) {
    app.draft = defaultDecisions(game);
    // Yesterday's stock may cost more than this morning's cash can pay for.
    app.draft.stock = Math.min(app.draft.stock, draftFacts(game, app.draft).affordableStock);
    app.draft.seats = Math.min(app.draft.seats, game.seatsOwned);
  }
  const { draft } = app;

  const notes = { staff: h('p', { class: 'choice__note' }), price: h('p', { class: 'choice__note' }), stock: h('p', { class: 'choice__note' }), seats: h('p', { class: 'choice__note' }) };
  const sums = { left: h('dd'), evening: h('dd'), even: h('dd') };
  const problem = h('p', { class: 'problem', role: 'alert', hidden: true });
  const open = h('button', { type: 'button', class: 'btn btn--main btn--wide' }, [ic('storefront'), 'Buka warung']);
  open.addEventListener('click', () => {
    if (checkDecisions(game, draft).length > 0) return;
    openWarung();
  });

  const preview = () => {
    showStall({ staff: draft.staff, seats: draft.seats, light: MORNING_LIGHT });
    foot(h('span', { text: `Lapakmu hari ini: ${draft.staff} pegawai, ${draft.seats} bangku tunggu.` }));
  };

  const steppers = {
    staff: stepper({ name: 'pegawai', value: draft.staff, ...LIMITS.staff, onChange: (value) => change('staff', value, true) }),
    price: stepper({ name: 'harga', value: draft.price, ...LIMITS.price, format: rupiah, onChange: (value) => change('price', value) }),
    stock: stepper({ name: 'stok', value: draft.stock, min: LIMITS.stock.min, max: LIMITS.stock.max, step: 5, onChange: (value) => change('stock', value) }),
    seats: stepper({ name: 'bangku', value: draft.seats, min: LIMITS.seats.min, max: game.seatsOwned, onChange: (value) => change('seats', value, true) }),
  };

  function change(field, value, shownInScene = false) {
    draft[field] = value;
    update();
    if (shownInScene) preview();
  }

  /** Everything that follows from the choices by arithmetic, written out again. */
  function update() {
    const facts = draftFacts(game, draft);
    const perThousand = 1 - Math.exp(-1000 / DEMAND.priceSensitivity);

    notes.staff.replaceChildren('Sanggup ', live(compact(facts.capacity[0])), ' pelanggan per jam. Gaji ', live(rupiah(facts.wages)), '.');
    notes.price.replaceChildren(
      ...(facts.margin > 0 ? ['Untung ', live(rupiah(facts.margin)), ' per porsi. '] : [live('Rugi tiap porsi'), '. ']),
      `Naik ${rupiah(1000)}, yang datang turun ${percent(perThousand)}.`,
    );
    notes.stock.replaceChildren(
      'Modal ',
      live(rupiah(facts.ingredients)),
      ', sisanya basi. Kasmu cukup untuk ',
      live(`${integer(facts.affordableStock)} porsi`),
      '.',
      yesterday ? ` Kemarin terjual ${integer(yesterday.results.served)}.` : '',
    );
    notes.seats.replaceChildren(live(`${draft.seats} dari ${game.seatsOwned}`), ' bangku dipasang. Yang tidak dapat bangku balik kanan.');
    steppers.stock.setMax(Math.min(LIMITS.stock.max, facts.affordableStock));

    sums.left.textContent = rupiah(facts.cashLeft);
    sums.left.className = facts.cashLeft < 0 ? 'is-bad' : '';
    sums.evening.textContent = rupiah(facts.wages + facts.rent);
    sums.even.textContent = Number.isFinite(facts.breakEven) ? `${integer(Math.ceil(facts.breakEven))} porsi` : 'tidak bisa';

    // Under the stall: the hours of yesterday against the capacity being chosen now.
    const capacity = facts.capacity[0];
    const arrivals = Array.from({ length: DAY.hours }, (_, hour) => yesterday?.results.periods[hour]?.arrivals ?? 0);
    if (yesterday) {
      const busiest = arrivals.indexOf(Math.max(...arrivals));
      under(
        hours('Yang datang kemarin, dan kapasitasmu hari ini', arrivals, capacity, [
          `Jam teramai kemarin ${hourRange(busiest)}: ${integer(arrivals[busiest])} orang datang, dan kamu sanggup `,
          live(`${compact(capacity)} per jam`),
          arrivals[busiest] > capacity ? '. Antrean akan menumpuk di jam itu.' : '. Masih cukup.',
        ]),
      );
    } else {
      under(
        hours('Kapasitasmu hari ini', arrivals, capacity, [
          'Garis putus-putus adalah yang sanggup kamu layani tiap jam. Mulai besok, jumlah yang datang ikut tampil di sini.',
        ]),
      );
    }

    const blocked = checkDecisions(game, draft).length > 0;
    open.setAttribute('aria-disabled', String(blocked));
    problem.hidden = !blocked;
    problem.textContent = blocked ? (facts.cashLeft < 0 ? `Kasnya kurang ${rupiah(-facts.cashLeft)}. Kurangi stok dulu.` : 'Masih ada pilihan yang belum bisa dijalankan.') : '';
  }

  const choice = (label, control, note) =>
    h('div', { class: 'choice' }, [h('span', { class: 'choice__label', text: label }), control.element, note]);
  const news = draftFacts(game, draft).news;
  const sum = (label, value) => h('div', {}, [h('dt', { text: label }), value]);

  let words;
  if (!yesterday) {
    words = ['Selamat pagi! Warung ini ramai dua kali: sekitar jam 12 siang dan jam 6 sore. Di luar itu biasanya sepi.'];
  } else {
    const { arrivals, served } = yesterday.results;
    const { profit } = yesterday.ledger;
    words = [
      `Kemarin ${integer(arrivals)} orang datang dan ${integer(served)} kebagian makan. `,
      h('strong', { text: profit >= 0 ? `Untung ${rupiah(profit)}.` : `Rugi ${rupiah(-profit)}.` }),
    ];
  }

  preview();
  mount('panel--morning', [
    h('h1', { text: 'Hari ini mau gimana?' }),
    says(words, yesterday ? (yesterday.ledger.profit >= 0 ? 'happy' : 'sad') : undefined),
    news &&
      h('div', { class: 'news' }, [
        h('strong', { text: `Kabar pagi: ${EVENT_TEXT[news.id].name}` }),
        h('p', { text: EVENT_TEXT[news.id].morning(news) }),
      ]),
    h('div', { class: 'choices' }, [
      choice('Pegawai', steppers.staff, notes.staff),
      choice('Harga per porsi', steppers.price, notes.price),
      choice('Stok masakan', steppers.stock, notes.stock),
      choice('Bangku tunggu', steppers.seats, notes.seats),
    ]),
    // The three figures the morning comes down to, and the way on, stay in sight however long the panel is.
    h('div', { class: 'panel__go' }, [
      h('dl', { class: 'sums sums--across' }, [sum('Sisa kas pagi', sums.left), sum('Dibayar malam', sums.evening), sum('Balik modal', sums.even)]),
      open,
      problem,
    ]),
  ]);
  update();
}

// --- Midday ------------------------------------------------------------------------------

function openWarung() {
  app.day = startDay(app.game, app.draft);
  go('day');
}

function renderDay() {
  const { simulation, decisions, model, event } = app.day;
  const staff = model.servers ?? Math.max(...model.staffSchedule.map((entry) => entry.servers));

  const clockValue = h('span', { class: 'stage__clock', text: clockText(0) });
  const progress = h('span');
  foot(clockValue, h('div', { class: 'stage__progress', 'aria-hidden': 'true' }, progress));

  const count = (label, mark, className = '') => {
    const value = h('dd', { text: '0' });
    return { value, element: h('div', { class: `count ${className}` }, [h('dt', {}, [mark && h('span', { class: `mark mark--${mark}` }), label]), value]) };
  };
  const counts = {
    revenue: count('Uang masuk', null, 'count--wide'),
    served: count('Dilayani', 'served'),
    stock: count('Sisa stok'),
    reneged: count('Batal antre', 'reneged'),
    rejected: count('Bangku penuh', 'balked'),
    soldOut: count('Kehabisan', 'soldout'),
    arrivals: count('Datang'),
  };

  const heading = h('h1', { text: 'Warung buka.' });
  const line = h('p', {}, ['Pelanggan datang, menunggu, dan dilayani. Kamu tinggal menonton.']);
  const happening = h('div', { class: 'news', hidden: true });
  const playLabel = h('span', { text: 'Jeda' });
  const playIcon = h('span', {}, ic('pause'));
  const playButton = h('button', { type: 'button', class: 'btn' }, [playIcon, playLabel]);
  const speeds = PACES.map((pace) =>
    h('button', { type: 'button', 'aria-pressed': String(pace === 1), text: `${decimal(pace, pace < 1 ? 1 : 0)}×` }),
  );
  const skip = h('button', { type: 'button', class: 'btn' }, ['Langsung ke laporan', ic('caret-right')]);

  let done = false;
  let closing = null;
  let lastHud = 0;
  let revealed = false;
  let sales = 0;

  /** The day's event becomes known: news from the start, a surprise when it strikes. */
  function reveal(now) {
    if (!event || revealed || !EVENT_TEXT[event.id]) return;
    const surprise = event.kind === EVENT_KIND.SURPRISE;
    if (surprise && now < (event.time ?? 0)) return;
    revealed = true;
    const text = EVENT_TEXT[event.id];
    happening.replaceChildren(
      h('strong', { text: `${surprise ? 'Kejutan' : 'Kabar pagi'}: ${text.name}` }),
      h('p', { text: surprise ? text.struck(event) : text.happened(event) }),
    );
    happening.hidden = false;
  }

  function hud() {
    const { arrivals, served, reneged, rejected, soldOut } = simulation.results;
    reveal(player.clock);
    clockValue.textContent = clockText(Math.min(player.clock, DAY.hours));
    progress.style.transform = `scaleX(${Math.min(player.clock / DAY.hours, 1)})`;
    counts.revenue.value.textContent = rupiah(served * decisions.price);
    counts.served.value.textContent = integer(served);
    counts.stock.value.replaceChildren(integer(simulation.stock), h('small', { text: ` dari ${integer(decisions.stock)}` }));
    counts.reneged.value.textContent = integer(reneged);
    counts.rejected.value.textContent = integer(rejected);
    counts.soldOut.value.textContent = integer(soldOut);
    counts.arrivals.value.textContent = integer(arrivals);
  }

  /** One line about what has just happened at the stall. */
  function tell(record) {
    let text = null;
    if (record.type === EVENT.RENEGE) text = 'Ada yang batal antre. Kelamaan menunggu.';
    else if (record.type === EVENT.BATCH_ARRIVAL) text = 'Wah, rombongan datang!';
    else if (record.type === EVENT.SOLD_OUT) text = 'Masakannya habis.';
    else if (record.type === EVENT.CLOSE) text = 'Tutup dulu, ya.';
    else if (record.type === EVENT.ARRIVAL && record.outcome === ARRIVAL_OUTCOME.REJECTED) text = 'Bangkunya penuh, satu orang balik kanan.';
    else if (record.type === EVENT.ARRIVAL && record.outcome === ARRIVAL_OUTCOME.SOLD_OUT) text = 'Ada yang datang, tapi masakannya sudah habis.';
    else if (record.type === EVENT.DEPARTURE && ++sales % 12 === 0) text = 'Laris manis!';
    if (text) line.textContent = text;
  }

  function finish() {
    if (done) return;
    done = true;
    window.clearTimeout(closing);
    const { state, report } = app.day.finish();
    app.game = state;
    app.report = report;
    app.day = null;
    app.draft = null;
    go('night');
  }

  let skipping = false;
  const player = showRunning(simulation, {
    seats: decisions.seats,
    staff,
    price: decisions.price,
    weather: event?.id === 'rain' ? 'rain' : null,
    onRecord: (record) => {
      if (!skipping) tell(record);
    },
    onFrame: () => {
      const now = performance.now();
      if (now - lastHud < HUD_INTERVAL_MS) return;
      lastHud = now;
      hud();
    },
    onEnd: () => {
      hud();
      heading.textContent = 'Warung tutup.';
      closing = window.setTimeout(finish, reducedMotion ? 0 : CLOSING_PAUSE_MS);
    },
  });

  playButton.addEventListener('click', () => {
    if (player.playing) player.pause();
    else player.play();
    playLabel.textContent = player.playing ? 'Jeda' : 'Putar';
    playIcon.replaceChildren(ic(player.playing ? 'pause' : 'play'));
  });
  speeds.forEach((button, i) =>
    button.addEventListener('click', () => {
      player.setPace(PACES[i]);
      speeds.forEach((other, j) => other.setAttribute('aria-pressed', String(i === j)));
    }),
  );
  skip.addEventListener('click', () => {
    skipping = true;
    player.skip();
    finish();
  });
  if (reducedMotion) {
    playLabel.textContent = 'Putar';
    playIcon.replaceChildren(ic('play'));
  }

  const mark = (key, text) => h('li', {}, [h('span', { class: `mark mark--${key}` }), text]);
  under(
    h('ul', { class: 'legend' }, [
      mark('served', 'pulang bawa bungkusan: dilayani'),
      mark('reneged', 'tanda seru: batal antre'),
      mark('balked', 'tanda silang: bangku penuh'),
      mark('soldout', 'piring dicoret: kehabisan'),
    ]),
  );

  mount('panel--day', [
    heading,
    says([line]),
    happening,
    h('dl', { class: 'counts' }, Object.values(counts).map((item) => item.element)),
    h('div', { class: 'actions' }, [playButton, h('div', { class: 'speeds', role: 'group', 'aria-label': 'Kecepatan' }, speeds), skip]),
  ]);
  hud();
}

// --- Evening ---------------------------------------------------------------------------

function renderNight() {
  const { game, report } = app;
  const { ledger, results, decisions } = report;
  const gain = ledger.profit >= 0;
  showStall({ staff: decisions.staff, seats: decisions.seats, light: NIGHT_LIGHT, closed: true });
  foot(h('span', { text: `Hari ke-${report.day} selesai. Warung tutup.` }));

  const endings = [
    ['served', results.served, 'dilayani'],
    ['reneged', results.reneged, 'batal antre'],
    ['balked', results.rejected, 'bangku penuh'],
    ['soldout', results.soldOut, 'kehabisan'],
  ];
  const costliest = dayFindings(report).find((finding) => finding.cost > 0) ?? null;
  const sum = (label, value, className = '') => h('div', { class: className }, [h('dt', { text: label }), h('dd', { text: value })]);
  const over = game.status !== STATUS.PLAYING;

  const arrivals = Array.from({ length: DAY.hours }, (_, hour) => results.periods[hour]?.arrivals ?? 0);
  const capacity = decisions.staff * report.setup.serviceRate;
  const crowded = arrivals.filter((count) => count > capacity).length;
  under(
    hours('Yang datang hari ini, jam demi jam', arrivals, capacity, [
      crowded > 0
        ? `Di ${crowded} jam yang merah, yang datang lebih banyak daripada yang sanggup dilayani (${compact(capacity)} per jam).`
        : `Tidak ada jam yang melebihi kapasitasmu (${compact(capacity)} per jam).`,
    ]),
  );

  mount('panel--night', [
    h('div', { class: 'result' }, [
      h('p', { class: 'result__label', text: `Hari ke-${report.day}: ${gain ? 'untung' : 'rugi'}` }),
      h('h1', { class: `result__amount ${gain ? 'is-good' : 'is-bad'}`, text: rupiah(Math.abs(ledger.profit)) }),
    ]),
    says(
      [
        `Kas sekarang ${rupiah(ledger.cashAfter)}. Reputasi dari ${decimal(report.reputationBefore, 1)} ke `,
        h('strong', { text: decimal(report.reputationAfter, 1) }),
        '.',
      ],
      gain ? 'happy' : 'sad',
    ),
    h('div', {}, [
      h(
        'div',
        { class: 'flow', 'aria-hidden': 'true' },
        endings.filter(([, n]) => n > 0).map(([key, n]) => h('span', { class: `mark--${key}`, style: `flex-grow: ${n}` })),
      ),
    ]),
    h(
      'ul',
      { class: 'endings' },
      endings.map(([key, n, label]) => h('li', {}, [h('span', { class: `mark mark--${key}` }), h('b', { text: integer(n) }), h('span', { text: label })])),
    ),
    h('dl', { class: 'sums' }, [
      sum(`Pendapatan, ${integer(results.served)} porsi`, rupiah(ledger.revenue)),
      sum('Bahan', rupiah(-ledger.ingredients)),
      sum('Gaji', rupiah(-ledger.wages)),
      sum('Sewa', rupiah(-ledger.rent)),
      sum(gain ? 'Laba' : 'Rugi', rupiah(ledger.profit), 'sums__total'),
    ]),
    costliest &&
      h('section', { class: 'why' }, [
        h('div', { class: 'why__top' }, [h('h2', { text: costliest.title }), h('span', { class: 'num is-bad', text: rupiah(costliest.cost) })]),
        h('p', { text: `Ini yang paling mahal hari ini. ${costliest.advice}` }),
      ]),
    h('div', { class: 'actions' }, [
      h('button', { type: 'button', class: 'btn btn--main btn--wide', onclick: () => go(over ? 'end' : 'morning') }, [
        over ? 'Lihat hasil akhir' : `Siapkan hari ke-${game.day}`,
        ic('caret-right'),
      ]),
    ]),
  ]);
}

// --- The end ---------------------------------------------------------------------------

function renderEnd() {
  const { game } = app;
  const won = game.status === STATUS.WON;
  const last = game.history.at(-1).decisions;
  showStall({ staff: last.staff, seats: last.seats, light: NIGHT_LIGHT, closed: true });
  foot(h('span', { text: won ? `${DAY.count} hari selesai.` : `Berhenti di hari ke-${game.history.length}.` }));
  under();
  const earned = stars(game);
  mount('panel--end', [
    h('h1', { text: won ? 'Warung bertahan.' : 'Kasnya habis.' }),
    says(
      [
        won
          ? `Empat belas hari, dan kasnya jadi ${rupiah(game.cash)}. Itu ${earned} dari 3 bintang.`
          : 'Warung terpaksa tutup. Jawabannya biasanya ada di antrean, harga, atau stok.',
      ],
      won ? 'happy' : 'sad',
    ),
    h('div', { class: 'actions' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--main',
          onclick: () => {
            startGame();
            go('morning');
          },
        },
        [ic('arrow-counter-clockwise'), 'Main lagi'],
      ),
    ]),
  ]);
}

// --- Going from one screen to the next ----------------------------------------------------

const SCREENS = { home: renderHome, morning: renderMorning, day: renderDay, night: renderNight, end: renderEnd };

function go(screen) {
  const draw = () => {
    app.screen = screen;
    SCREENS[screen]();
    renderChrome();
    window.scrollTo(0, 0);
  };
  // The panel crosses over while the warung stays where it is (see view-transition-name in the CSS).
  if (!document.startViewTransition || reducedMotion) return draw();
  // A browser may skip the transition (in a tab that is not showing, for one);
  // the screen has changed all the same, so there is nothing to report.
  const transition = document.startViewTransition(draw);
  for (const outcome of [transition.ready, transition.finished, transition.updateCallbackDone]) outcome.catch(() => {});
}

document.getElementById('home-link').addEventListener('click', (event) => {
  event.preventDefault();
  // A day in progress is not left half-played.
  if (app.screen !== 'day') go('home');
});

SCREENS.home();
renderChrome();
