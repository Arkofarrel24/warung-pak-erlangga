/**
 * Morning: the player's decisions for the day.
 *
 * The form is built once and then kept up to date by update(), which
 * recomputes everything that follows from the decisions (costs, capacity,
 * the break-even point, rule violations). Nothing here is a forecast of the
 * day: every number shown is plain arithmetic on the decisions, a fact from
 * yesterday's report, or this morning's news.
 *
 * Numbers that move when a decision changes are marked (see `live` below),
 * so they stand out from the fixed words around them and flash when they
 * change.
 */

import { challengeForDay } from '../game/challenges.js';
import { CHALLENGES, COSTS, DAY, DEMAND, GROWTH, LIMITS, RENT_RISE, REPUTATION, SHIFTS, START } from '../game/config.js';
import { wagePerHour } from '../game/day.js';
import { priceFactor } from '../game/demand.js';
import { checkDecisions } from '../game/game.js';
import { dayCalendar } from './calendar.js';
import { createStepper, showFieldError } from './controls.js';
import { h, icon, svg } from './dom.js';
import { basketCount, draftFacts, loadDraft, saveDraft } from './draft.js';
import { compact, decimal, hourRange, hourTick, integer, percent, rupiah, spokenRupiah } from './format.js';
import { createLiveNumbers, pop, refuse } from './motion.js';
import { bubble } from './pak-erlangga.js';
import { CHALLENGE_TEXT, EVENT_TEXT, problemText, SHIFT_LABELS, SHOP_NAME } from './text.js';
import { startTour } from './tour.js';

/** How long the screen is left to settle before the first-day guide starts. */
const TOUR_DELAY_MS = 900;

/** "a", "a dan b", "a, b, dan c". */
function list(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return items.join(' dan ');
  return `${items.slice(0, -1).join(', ')}, dan ${items.at(-1)}`;
}

/** Whether a morning's four choices are the same as another's (or as the starting setup). */
function sameChoices(decisions, other) {
  const shifts = (choices) => JSON.stringify(choices.shifts ?? null);
  return (
    decisions.staff === other.staff &&
    decisions.price === other.price &&
    decisions.stock === other.stock &&
    decisions.seats === other.seats &&
    shifts(decisions) === shifts(other)
  );
}

function boughtNothing({ buy = {} }) {
  return !(buy.seats > 0) && !buy.training && !(buy.upgrades?.length > 0);
}

/**
 * What Pak Erlangga says to a player who ran yesterday exactly like the day
 * before while customers went home unserved: what standing still cost.
 */
function standingStill(game) {
  const yesterday = game.history.at(-1);
  const before = game.history.at(-2);
  const unchanged = boughtNothing(yesterday.decisions) && sameChoices(yesterday.decisions, before?.decisions ?? START);
  const { reneged, rejected, soldOut } = yesterday.results;
  const lost = reneged + rejected + soldOut;
  if (!unchanged || lost === 0) return null;
  const people = integer(lost);
  const worth = rupiah(lost * yesterday.decisions.price);
  // The same point, put differently from one morning to the next.
  const ways = [
    `Omong-omong, pengaturanmu kemarin sama persis dengan ${before ? 'hari sebelumnya' : 'cara saya dulu'}. ` +
      `Padahal ${people} orang pulang tanpa makan: itu ${worth} yang lewat begitu saja. ` +
      'Coba ubah satu hal hari ini, lalu lihat bedanya di laporan.',
    `Pengaturannya masih sama seperti kemarin, ya? ${people} orang lagi pulang tanpa makan, senilai ${worth}. ` +
      'Satu perubahan kecil saja sudah cukup untuk melihat bedanya.',
    `Hari ini mau coba yang lain? Dengan pengaturan yang sama, kemarin ${people} orang lepas. ` +
      `Itu ${worth} yang tidak jadi masuk kas.`,
  ];
  return ways[game.day % ways.length];
}

/** The rent rise of the second week, said ahead of time and again when it arrives. */
function rentWords(day) {
  const higher = rupiah(COSTS.rent + RENT_RISE.amount);
  if (day === 1) {
    return (
      `Oh ya, satu lagi. Pemilik ruko sudah bilang: mulai hari ke-${RENT_RISE.fromDay} sewanya naik ` +
      `${rupiah(RENT_RISE.amount)} sehari. Katanya karena warung ini bakal makin ramai. Jadi jangan cuma jalan di tempat, ya.`
    );
  }
  if (day === RENT_RISE.fromDay - 1) return `Ingat, besok sewanya naik jadi ${higher} sehari, dan warungnya mulai lebih ramai. Sudah siap?`;
  if (day === RENT_RISE.fromDay)
    return `Mulai hari ini sewanya ${higher} sehari, dan yang datang kira-kira ${compact(GROWTH.demandFactor)} kali lipat biasanya. Cara lama belum tentu masih cukup.`;
  return null;
}

/** What Pak Erlangga says in the morning: a hint on day 1, yesterday's facts after that. */
function morningWords(game) {
  const yesterday = game.history.at(-1);
  const paragraph = (text) => text && h('p', { text });
  if (!yesterday) {
    return [
      paragraph(
        'Selamat pagi! Warung ini punya dua jam ramai: makan siang sekitar jam 12, dan makan malam sekitar jam 6 sore. ' +
          `Di luar itu biasanya sepi. Dulu saya jalan dengan ${START.staff} pegawai dan harga ${rupiah(START.price)} seporsi. ` +
          'Mau diubah? Silakan, sekarang kamu yang pegang.',
      ),
      paragraph(rentWords(game.day)),
    ];
  }
  const { arrivals, served, reneged, rejected, soldOut } = yesterday.results;
  const lost = [
    reneged > 0 && `${integer(reneged)} orang batal antre karena kelamaan menunggu`,
    rejected > 0 && `${integer(rejected)} balik kanan karena bangkunya penuh`,
    soldOut > 0 && `${integer(soldOut)} kehabisan`,
  ].filter(Boolean);
  const { profit } = yesterday.ledger;
  return [
    paragraph(
      `Kemarin ada ${integer(arrivals)} orang yang datang, dan ${integer(served)} di antaranya kebagian makan. ` +
        (lost.length > 0 ? `Sayangnya ${list(lost)}. ` : 'Tidak ada yang pulang kecewa. ') +
        (profit >= 0
          ? `Hasilnya, kita untung ${spokenRupiah(profit)}.`
          : lost.length > 0
            ? `Hasilnya, kita rugi ${spokenRupiah(-profit)}.`
            : `Tapi tetap rugi ${spokenRupiah(-profit)}: biaya hari itu lebih besar daripada hasil jualannya.`),
    ),
    paragraph(standingStill(game)),
    paragraph(rentWords(game.day)),
  ];
}

/**
 * Yesterday's arrivals per hour as bars, with today's capacity c·μ drawn
 * across them as a stepped line. Where a bar rises above the line, more
 * customers came than the pegawai could serve in that hour.
 */
function capacityChart(arrivals, capacity, hoursPerShift) {
  const width = 320;
  const height = 140;
  const left = 32;
  const right = 6;
  const top = 10;
  const bottom = 26;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const hours = arrivals.length;
  const slot = plotWidth / hours;
  // With no arrivals to show yet, the line sits at two thirds of the height.
  const peak = Math.max(...arrivals, ...capacity, 1) * (Math.max(...arrivals) > 0 ? 1.12 : 1.5);
  const y = (value) => top + plotHeight * (1 - value / peak);
  const hourCapacity = (hour) => capacity[Math.min(Math.floor(hour / hoursPerShift), capacity.length - 1)];

  // The axis is marked at zero and at each level of capacity, which are the
  // heights the bars are read against. Levels too close to tell apart share a mark.
  const grid = [0];
  for (const level of [...new Set(capacity)].sort((a, b) => a - b)) {
    if (y(grid.at(-1)) - y(level) >= 14) grid.push(level);
  }

  let line = '';
  for (let hour = 0; hour < hours; hour++) {
    const level = y(hourCapacity(hour));
    line += `${hour === 0 ? 'M' : 'L'}${left + hour * slot} ${level} L${left + (hour + 1) * slot} ${level} `;
  }

  return svg('svg', { class: 'capacity-chart', viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false' }, [
    ...grid.map((value) =>
      svg('g', {}, [
        svg('line', { class: 'capacity-chart__grid', x1: left, x2: width - right, y1: y(value), y2: y(value) }),
        svg('text', { class: 'capacity-chart__tick', x: left - 7, y: y(value) + 4, 'text-anchor': 'end', text: compact(value, 0) }),
      ]),
    ),
    ...arrivals.map((count, hour) =>
      svg('rect', {
        class: count > hourCapacity(hour) ? 'capacity-chart__bar capacity-chart__bar--over' : 'capacity-chart__bar',
        x: left + hour * slot + 2,
        y: y(count),
        width: slot - 4,
        height: Math.max(y(0) - y(count), 0),
        rx: 2,
      }),
    ),
    svg('path', { class: 'capacity-chart__line', d: line.trim() }),
    ...arrivals.map((_, hour) =>
      hour % 2 === 0
        ? svg('text', {
            class: 'capacity-chart__tick',
            x: left + hour * slot + slot / 2,
            y: height - 7,
            'text-anchor': 'middle',
            text: hourTick(hour),
          })
        : null,
    ),
  ]);
}

export function renderMorning(container, { store, openWarung }) {
  const { game } = store;
  const yesterday = game.history.at(-1) ?? null;
  const draft = loadDraft(store);
  const referencePrice = yesterday?.decisions.price ?? draft.price;

  const live = createLiveNumbers();

  // --- Staff ---------------------------------------------------------------

  const staffError = h('p', { class: 'field-error', id: 'staff-error', role: 'alert', hidden: true });
  const staffHelp = h('p', { class: 'decision__help', id: 'staff-help' });
  const staffStepper = createStepper({
    id: 'staff',
    name: 'pegawai',
    value: draft.staff,
    ...LIMITS.staff,
    suffix: 'orang',
    describedBy: 'staff-help staff-error',
    onChange: (value) => {
      draft.staff = value;
      update();
    },
  });
  const shiftSteppers = SHIFTS.map((shift, i) =>
    createStepper({
      id: `shift-${shift.id}`,
      name: `pegawai shift ${SHIFT_LABELS[i]}`,
      value: draft.shifts?.[i] ?? draft.staff,
      ...LIMITS.staff,
      small: true,
      describedBy: 'staff-help staff-error',
      onChange: (value) => {
        draft.shifts[i] = value;
        update();
      },
    }),
  );
  const shiftToggle = h('input', { type: 'checkbox', id: 'use-shifts', class: 'switch__input' });
  const shiftSwitch = h('label', { class: 'switch', for: 'use-shifts' }, [
    shiftToggle,
    h('span', { class: 'switch__track', 'aria-hidden': 'true' }),
    h('span', { text: 'Atur per shift' }),
  ]);
  shiftToggle.addEventListener('change', () => {
    draft.shifts = shiftToggle.checked ? SHIFTS.map(() => draft.staff) : null;
    shiftSteppers.forEach((stepper) => stepper.set(draft.staff));
    update();
  });
  const dailyStaff = h('div', { class: 'decision__control' }, staffStepper.element);
  const shiftGrid = h(
    'div',
    { class: 'shift-grid' },
    SHIFTS.map((shift, i) =>
      h('div', { class: 'shift-grid__item' }, [
        h('label', { for: `shift-${shift.id}`, text: SHIFT_LABELS[i] }),
        shiftSteppers[i].element,
      ]),
    ),
  );

  // --- Price ---------------------------------------------------------------

  const priceError = h('p', { class: 'field-error', id: 'price-error', role: 'alert', hidden: true });
  const priceHelp = h('p', { class: 'decision__help', id: 'price-help' });
  const priceSlider = h('input', {
    type: 'range',
    class: 'slider',
    min: LIMITS.price.min,
    max: LIMITS.price.max,
    step: LIMITS.price.step,
    value: draft.price,
    'aria-label': 'Harga per porsi, geser',
    tabindex: '-1',
  });
  const priceStepper = createStepper({
    id: 'price',
    name: 'harga',
    value: draft.price,
    min: LIMITS.price.min,
    max: LIMITS.price.max,
    step: LIMITS.price.step,
    prefix: 'Rp',
    describedBy: 'price-help price-error',
    onChange: (value) => {
      draft.price = value;
      priceSlider.value = String(value);
      update();
    },
  });
  priceSlider.addEventListener('input', () => {
    draft.price = Number(priceSlider.value);
    priceStepper.set(draft.price);
    update();
  });

  // --- Stock ---------------------------------------------------------------

  const stockError = h('p', { class: 'field-error', id: 'stock-error', role: 'alert', hidden: true });
  const stockHelp = h('p', { class: 'decision__help', id: 'stock-help' });
  const stockWarning = h('p', { class: 'decision__warn', id: 'stock-warn', role: 'status', hidden: true });
  const stockStepper = createStepper({
    id: 'stock',
    name: 'stok',
    value: draft.stock,
    ...LIMITS.stock,
    step: 5,
    snap: 1,
    suffix: 'porsi',
    describedBy: 'stock-help stock-error',
    onChange: (value) => {
      draft.stock = value;
      update();
    },
  });

  // --- Seats ---------------------------------------------------------------

  const seatsError = h('p', { class: 'field-error', id: 'seats-error', role: 'alert', hidden: true });
  const seatsHelp = h('p', { class: 'decision__help', id: 'seats-help' });
  const seatsStepper = createStepper({
    id: 'seats',
    name: 'bangku yang dipasang',
    value: draft.seats,
    min: LIMITS.seats.min,
    max: game.seatsOwned + draft.buy.seats,
    suffix: 'bangku',
    describedBy: 'seats-help seats-error',
    onChange: (value) => {
      draft.seats = value;
      update();
    },
  });

  /**
   * One choice. A card with something to show next to its control (`aside`)
   * takes the whole row, control on the left and the rest on the right.
   */
  function decisionCard({ iconName, id, label, control, help, error, extra, aside }) {
    const main = [
      h('div', { class: 'decision__head' }, [
        h('span', { class: 'decision__icon' }, icon(iconName)),
        h('label', { class: 'decision__label', for: id, text: label }),
      ]),
      control,
      extra,
      help,
      error,
    ];
    if (!aside) return h('article', { class: 'card decision' }, main);
    return h('article', { class: 'card decision decision--wide' }, [
      h('div', { class: 'decision__main' }, main),
      h('div', { class: 'decision__aside' }, aside),
    ]);
  }

  // Yesterday's arrivals against today's capacity: next to the choice that
  // moves the line, with what the picture says in words under the control.
  const chartSlot = h('div', { class: 'capacity' });
  const chartNote = h('p', { class: 'decision__help' });

  const staffCard = decisionCard({
    iconName: 'users',
    id: 'staff',
    label: 'Pegawai',
    control: h('div', {}, [dailyStaff, shiftGrid]),
    extra: shiftSwitch,
    help: [staffHelp, chartNote],
    error: staffError,
    aside: chartSlot,
  });
  const priceCard = decisionCard({
    iconName: 'tag',
    id: 'price',
    label: 'Harga per porsi',
    control: h('div', { class: 'decision__control' }, [priceStepper.element, priceSlider]),
    help: priceHelp,
    error: priceError,
  });
  const stockCard = decisionCard({
    iconName: 'bowl',
    id: 'stock',
    label: 'Stok masakan',
    control: h('div', { class: 'decision__control' }, stockStepper.element),
    help: [stockHelp, stockWarning],
    error: stockError,
  });
  const seatsCard = decisionCard({
    iconName: 'chair',
    id: 'seats',
    label: 'Bangku tunggu',
    control: h('div', { class: 'decision__control' }, seatsStepper.element),
    error: seatsError,
    aside: seatsHelp,
  });

  // --- The shop next door ---------------------------------------------------

  const basketLine = h('p', { class: 'teaser__basket' });
  const shopTeaser = h('section', { class: 'card teaser', 'aria-labelledby': 'shop-title' }, [
    h('span', { class: 'teaser__icon' }, icon('basket')),
    h('div', { class: 'teaser__body' }, [
      h('h2', { id: 'shop-title', text: `Mampir ke ${SHOP_NAME}?` }),
      h('p', { text: 'Ada bangku plastik, pelatihan, sampai mesin kasir. Siapa tahu ada yang bikin warungmu makin gesit.' }),
      basketLine,
    ]),
    h('a', { class: 'btn teaser__go', href: '#/toko' }, [h('span', { text: 'Lihat-lihat' }), icon('chevron-right')]),
  ]);

  // --- Morning receipt -----------------------------------------------------

  const row = (label, note) => {
    const term = h('dt', {}, [label, note && h('small', { text: note })]);
    const amount = h('dd');
    return { element: h('div', { class: 'nota__row' }, [term, amount]), term, amount };
  };
  const cashRow = row('Kas pagi ini');
  const purchasesRow = row(`Belanja di ${SHOP_NAME}`);
  const ingredientsRow = row('Bahan');
  const leftRow = row('Sisa kas');
  leftRow.element.classList.add('nota__row--total');
  const wagesRow = row('Gaji');
  const rentRow = row(
    'Sewa',
    game.day < RENT_RISE.fromDay
      ? `naik ${rupiah(RENT_RISE.amount)} mulai hari ke-${RENT_RISE.fromDay}`
      : `sudah naik ${rupiah(RENT_RISE.amount)} sejak hari ke-${RENT_RISE.fromDay}`,
  );
  const breakEvenRow = row('Titik impas');

  const nota = h('section', { class: 'nota', 'aria-labelledby': 'nota-title' }, [
    h('h2', { class: 'nota__title', id: 'nota-title', text: 'Nota pagi' }),
    h('dl', { class: 'nota__rows' }, [
      cashRow.element,
      purchasesRow.element,
      ingredientsRow.element,
      h('hr', { class: 'nota__rule' }),
      leftRow.element,
    ]),
    h('h3', { class: 'nota__subtitle', text: 'Dibayar malam ini dari hasil jualan' }),
    h('dl', { class: 'nota__rows' }, [
      wagesRow.element,
      rentRow.element,
      h('hr', { class: 'nota__rule' }),
      breakEvenRow.element,
    ]),
  ]);

  // --- The queue today, in the notation of queueing theory -------------------

  const parameter = (symbol, label) => {
    const value = h('dd');
    return {
      element: h('div', { class: 'param' }, [
        h('dt', {}, [h('span', { class: 'chip chip--param', text: symbol }), label]),
        value,
      ]),
      value,
    };
  };
  const paramStaff = parameter('c', 'Pegawai melayani');
  const paramRate = parameter('μ', 'Kecepatan tiap pegawai');
  const paramCapacity = parameter('c·μ', 'Kapasitas');
  const paramRoom = parameter('K', 'Muat di dalam');
  const paramPatience = parameter('1/θ', 'Sabar rata-rata');

  const queueNotes = h('details', { class: 'details details--block' }, [
    h('summary', { text: 'Pilihanmu dalam huruf teori antrean (c, μ, K, θ)' }),
    h('p', {
      class: 'details__lead',
      text: 'Pilihanmu di atas, ditulis dengan huruf yang dipakai teori antrean. Huruf yang sama muncul lagi di laporan malam.',
    }),
    h('dl', { class: 'params' }, [
      paramStaff.element,
      paramRate.element,
      paramCapacity.element,
      paramRoom.element,
      paramPatience.element,
    ]),
  ]);

  // --- Open the warung -----------------------------------------------------

  const blocked = h('p', { class: 'cta__blocked', id: 'cta-blocked', hidden: true });
  const openButton = h(
    'button',
    { type: 'button', class: 'btn btn--primary btn--block', 'aria-describedby': 'cta-blocked' },
    [icon('play'), h('span', { text: 'Buka warung' })],
  );
  const ctaSummary = h('p', { class: 'cta__summary num' });
  const cta = h('div', { class: 'cta' }, [ctaSummary, openButton, blocked]);
  openButton.addEventListener('click', () => {
    if (checkDecisions(game, draft).length > 0) {
      // The press was heard: the button shakes its head, and the reason beside it stands out.
      refuse(openButton);
      pop(blocked);
      return;
    }
    openWarung(draft);
  });

  // --- The guide ------------------------------------------------------------

  let tour = null;
  let tourTimer = null;

  /** Pak Erlangga walks through the screen, one control at a time. */
  function showGuide() {
    if (tour) return;
    tour = startTour(
      [
        {
          // The four choices, as one thing: each card says in its own words what it does.
          target: () => document.querySelector('.decisions'),
          title: 'Pilihanmu hari ini',
          text: 'Pegawai, harga, stok, dan bangku. Ubah-ubah dulu sesukamu: angka berlatar kuning selalu ikut berubah.',
        },
        {
          target: nota,
          title: 'Nota pagi',
          text: 'Ini hitungan uangmu: yang dibayar pagi ini, yang dibayar malam nanti, dan berapa pelanggan supaya balik modal.',
        },
        {
          target: cta,
          title: 'Buka warung',
          text: 'Kalau sudah mantap, buka warungnya dari sini. Sisanya saya jelaskan sambil jalan.',
        },
      ],
      {
        onEnd: () => {
          tour = null;
          store.setPrefs({ tourSeen: true });
          guideButton.focus({ preventScroll: true });
        },
      },
    );
  }
  const guideButton = h('button', { type: 'button', class: 'bubble__action bubble__action--aside', onclick: showGuide }, [
    icon('info'),
    h('span', { text: 'Tutorial' }),
  ]);

  // --- Keeping everything in step with the decisions ------------------------

  function update() {
    // A schedule cannot outlive the board it is written on.
    const boardInUse = game.upgrades.shiftBoard || draft.buy.upgrades.includes('shiftBoard');
    if (!boardInUse) draft.shifts = null;

    const facts = draftFacts(game, draft);
    const problems = checkDecisions(game, draft);
    const problemFor = (...fields) => {
      const problem = problems.find((candidate) => fields.includes(candidate.field));
      return problem ? problemText(problem.code, { morningCost: facts.morningCost, cash: game.cash }) : null;
    };
    const hasBoard = facts.equipped.upgrades.shiftBoard;
    const usesShifts = hasBoard && draft.shifts !== null;

    // Staff
    shiftSwitch.hidden = !hasBoard;
    shiftToggle.checked = usesShifts;
    dailyStaff.hidden = usesShifts;
    shiftGrid.hidden = !usesShifts;
    const rateText = compact(facts.serviceRate);
    staffHelp.replaceChildren(
      ...(usesShifts
        ? ['Tiap pegawai melayani ', live('rate', rateText), ' pelanggan per jam. ']
        : [
            'Sanggup melayani ',
            live('capacity', `${draft.staff} × ${rateText} = ${compact(facts.capacity[0])}`),
            ' pelanggan per jam. ',
          ]),
      'Gaji hari ini ',
      live('wages', rupiah(facts.wages)),
      '.',
    );
    showFieldError(staffError, problemFor('staff', 'shifts'));

    // Price
    const perThousand = 1 - Math.exp(-1000 / DEMAND.priceSensitivity);
    const change = priceFactor(draft.price) / priceFactor(referencePrice) - 1;
    const demand =
      Math.abs(change) >= 0.005
        ? [
            `Dibanding ${yesterday ? 'harga kemarin' : 'harga awal'}, kira-kira `,
            live('demand', `${percent(Math.abs(change))} ${change < 0 ? 'lebih sedikit' : 'lebih banyak'}`),
            ' pelanggan.',
          ]
        : [`Tiap naik ${rupiah(1000)}, kira-kira ${percent(perThousand)} pelanggan memilih tidak datang.`];
    priceHelp.replaceChildren(
      ...(facts.margin > 0
        ? ['Untung ', live('margin', rupiah(facts.margin)), ' tiap porsi terjual. ']
        : [live('margin', 'Rugi tiap porsi'), ': harga ini tidak menutup modal bahan. ']),
      ...demand,
    );
    showFieldError(priceError, problemFor('price'));

    // Stock
    let memory = '';
    if (yesterday) {
      const { served, soldOut, stockLeft } = yesterday.results;
      memory = ` Kemarin terjual ${integer(served)} dari ${integer(yesterday.decisions.stock)} porsi`;
      if (soldOut > 0) memory += `, dan ${integer(soldOut)} pelanggan kehabisan.`;
      else if (stockLeft > 0) memory += `, dan ${integer(stockLeft)} porsi terbuang.`;
      else memory += '.';
    }
    stockHelp.replaceChildren(
      'Modal ',
      live('portion', rupiah(facts.perPortion)),
      ' per porsi, dan yang tidak terjual basi malam ini. Kasmu cukup untuk ',
      live('affordable', `${integer(facts.affordableStock)} porsi`),
      // Fewer than yesterday because the cash ran short: said, not done in silence.
      yesterday && draft.stock === facts.affordableStock && draft.stock < yesterday.decisions.stock
        ? `, jadi stoknya saya turunkan dari ${integer(yesterday.decisions.stock)}`
        : '',
      `.${memory}`,
    );
    // Not a forecast: the most the pegawai can serve in a day, and what came yesterday.
    const ceiling = Math.floor(facts.capacity.reduce((total, perHour) => total + perHour, 0) * (DAY.hours / facts.capacity.length));
    const came = yesterday?.results.arrivals ?? null;
    if (draft.stock > ceiling) {
      stockWarning.textContent = `Pegawaimu paling banyak sanggup melayani ${integer(ceiling)} porsi sehari. Sisanya pasti terbuang.`;
    } else if (came !== null && draft.stock > came * 1.25 * (game.day === GROWTH.fromDay ? GROWTH.demandFactor : 1)) {
      stockWarning.textContent = `Kemarin yang datang hanya ${integer(came)} orang. Stok sebanyak ini kemungkinan besar bersisa.`;
    } else {
      stockWarning.textContent = '';
    }
    stockWarning.hidden = stockWarning.textContent === '';
    // Short of cash is said here too: this is the number that mends it.
    showFieldError(stockError, problemFor('stock') ?? problemFor('cash'));
    // The plus stops where the cash does. A stock that is already above it
    // (after shopping next door) can still be brought down.
    stockStepper.setBounds(LIMITS.stock.min, Math.max(Math.min(LIMITS.stock.max, facts.affordableStock), draft.stock, LIMITS.stock.min));

    // Seats
    const seatsAvailable = game.seatsOwned + draft.buy.seats;
    // The reason to put out fewer stools than there are: a customer who waits
    // and then gives up (reneging) costs more reputation than one who finds
    // the place full and walks on (balking).
    const harm = compact(REPUTATION.renegePenalty / REPUTATION.turnedAwayPenalty);
    seatsHelp.replaceChildren(
      'Dipasang ',
      live('seats', `${draft.seats} dari ${seatsAvailable}`),
      ' bangku. ',
      draft.seats === 0
        ? 'Tanpa bangku, yang datang saat semua pegawai sibuk langsung balik kanan.'
        : `Yang kelamaan menunggu lalu batal antre merusak reputasi ${harm} kali lebih besar daripada yang balik kanan karena penuh.`,
      // The plus button stops at the stools owned: say where more come from.
      ...(draft.seats === seatsAvailable && seatsAvailable < LIMITS.seats.max
        ? [' Mau lebih banyak? ', h('a', { href: '#/toko', text: `Beli bangku di ${SHOP_NAME}` }), '.']
        : []),
    );
    showFieldError(seatsError, problemFor('seats', 'buy.seats'));

    // The basket from the shop next door
    const inBasket = basketCount(draft);
    basketLine.replaceChildren(
      ...(inBasket > 0
        ? ['Di keranjang: ', live('basket', `${inBasket} barang, ${rupiah(facts.purchases)}`), '. Dibayar saat warung buka.']
        : ['Keranjangmu masih kosong.']),
    );

    // Receipt
    cashRow.amount.textContent = rupiah(game.cash);
    purchasesRow.element.hidden = facts.purchases === 0;
    purchasesRow.amount.textContent = rupiah(-facts.purchases);
    ingredientsRow.term.replaceChildren(
      'Bahan',
      h('small', { text: `${integer(draft.stock)} porsi × ${rupiah(facts.perPortion)}` }),
    );
    ingredientsRow.amount.textContent = rupiah(-facts.ingredients);
    leftRow.amount.textContent = rupiah(facts.cashLeft);
    leftRow.amount.className = facts.cashLeft < 0 ? 'is-loss' : '';
    wagesRow.term.replaceChildren(
      'Gaji',
      h('small', { text: `${integer(facts.staffHours)} jam kerja × ${rupiah(wagePerHour(facts.equipped))}` }),
    );
    wagesRow.amount.textContent = rupiah(facts.wages);
    rentRow.amount.textContent = rupiah(facts.rent);
    breakEvenRow.term.replaceChildren(
      'Titik impas',
      h('small', { text: facts.margin > 0 ? '(gaji + sewa) ÷ untung seporsi' : 'tidak tercapai dengan harga ini' }),
    );
    breakEvenRow.amount.textContent = Number.isFinite(facts.breakEven)
      ? `${integer(Math.ceil(facts.breakEven))} pelanggan`
      : '-';

    // Queue parameters
    const distinctStaff = [...new Set(facts.staff)];
    const mostStaff = Math.max(...facts.staff);
    paramStaff.value.replaceChildren(
      live('p-staff', distinctStaff.length === 1 ? `${distinctStaff[0]} orang` : `${facts.staff.join(' / ')} per shift`),
    );
    paramRate.value.replaceChildren(
      live('p-rate', `${rateText} per jam`),
      ' ',
      h('span', { class: 'param__aside', text: `(${compact(60 / facts.serviceRate)} menit seorang)` }),
    );
    paramCapacity.value.replaceChildren(
      live(
        'p-capacity',
        distinctStaff.length === 1
          ? `${compact(facts.capacity[0])} pelanggan per jam`
          : `${facts.capacity.map((value) => compact(value, 0)).join(' / ')} per jam`,
      ),
    );
    paramRoom.value.replaceChildren(
      `${mostStaff} dilayani + ${draft.seats} menunggu = `,
      live('p-room', String(mostStaff + draft.seats)),
    );
    paramPatience.value.replaceChildren(live('p-patience', `${compact(facts.patienceMinutes)} menit`));

    // Yesterday against today's capacity
    const arrivals = Array.from({ length: DAY.hours }, (_, hour) => yesterday?.results.periods[hour]?.arrivals ?? 0);
    const legend = (className, text) => h('span', { class: 'legend__item' }, [h('span', { class: `legend__swatch ${className}` }), text]);
    if (yesterday) {
      const busiest = arrivals.indexOf(Math.max(...arrivals));
      const capacityThen = facts.capacity[Math.floor(busiest / facts.hoursPerShift)];
      const over = arrivals[busiest] > capacityThen;
      chartSlot.replaceChildren(
        h('h3', { class: 'capacity__title', text: 'Yang datang kemarin dan kapasitas hari ini' }),
        capacityChart(arrivals, facts.capacity, facts.hoursPerShift),
        h('p', { class: 'legend' }, [
          legend('legend__swatch--bar', 'datang kemarin, per jam'),
          legend('legend__swatch--line', 'kapasitas hari ini'),
        ]),
      );
      chartNote.replaceChildren(
        `Jam teramai kemarin ${hourRange(busiest)}: ${integer(arrivals[busiest])} pelanggan datang, ` +
          'sedangkan kapasitasmu hari ini di jam itu ',
        live('p-then', `${compact(capacityThen)} per jam`),
        over ? '. Antrean akan menumpuk di jam itu.' : '. Kapasitasmu masih cukup.',
      );
    } else {
      // Nobody has come yet, but today's capacity is already known.
      chartSlot.replaceChildren(
        h('h3', { class: 'capacity__title', text: 'Kapasitasmu hari ini, jam demi jam' }),
        capacityChart(arrivals, facts.capacity, facts.hoursPerShift),
        h('p', { class: 'legend' }, [legend('legend__swatch--line', 'kapasitas hari ini')]),
      );
      chartNote.textContent =
        'Mulai besok, batang jumlah pelanggan yang datang tiap jam ikut tampil di grafik, supaya kelihatan jam mana yang kewalahan.';
    }

    // Opening
    const canOpen = problems.length === 0;
    openButton.setAttribute('aria-disabled', String(!canOpen));
    blocked.hidden = canOpen;
    // What is wrong, in a few words, next to the button it holds back.
    blocked.textContent = canOpen
      ? ''
      : problems.some((problem) => problem.field === 'cash')
        ? `Kasnya kurang ${rupiah(-facts.cashLeft)}. Kurangi stok atau isi keranjang.`
        : 'Masih ada yang perlu dibetulkan sebelum warung bisa dibuka.';
    ctaSummary.textContent = `Sisa kas ${rupiah(facts.cashLeft)}`;
    ctaSummary.classList.toggle('is-loss', facts.cashLeft < 0);

    saveDraft(store, draft);
  }

  // --- Page ----------------------------------------------------------------

  const news = draftFacts(game, draft).news;
  const heading = h('h1', { id: 'view-title', tabindex: '-1', text: 'Siapkan warung hari ini' });
  container.append(
    h('section', { class: 'view view--pagi', 'aria-labelledby': 'view-title' }, [
      h('header', { class: 'view__head' }, [
        heading,
        dayCalendar(game, { planning: true }),
        // One small goal for the day, judged tonight from the report.
        h('p', { class: 'challenge' }, [
          h('span', { class: 'challenge__mark', 'aria-hidden': 'true' }, icon('target')),
          h('span', {}, [h('strong', { text: 'Tantangan hari ini: ' }), `${CHALLENGE_TEXT[challengeForDay(game.seed, game.day)]}.`]),
          h('span', { class: 'challenge__prize num', text: `cap + ${rupiah(CHALLENGES.reward)}` }),
        ]),
      ]),
      news &&
        h('section', { class: 'news', 'aria-labelledby': 'news-title' }, [
          h('p', { class: 'news__kicker' }, [icon('megaphone'), 'Kabar pagi']),
          h('h2', { class: 'news__title', id: 'news-title' }, [
            h('span', { class: 'news__icon' }, icon(EVENT_TEXT[news.id].icon)),
            EVENT_TEXT[news.id].name,
          ]),
          h('p', { class: 'news__text', text: EVENT_TEXT[news.id].morning(news) }),
        ]),
      // The desk: what he says and the four choices on the left; what they
      // cost, and the way out, on the right, where they stay in sight.
      h('div', { class: 'desk' }, [
        h('div', { class: 'desk__main' }, [
          // He greets the first morning, and carries yesterday's result on his face after that.
          bubble(
            [guideButton, ...morningWords(game)],
            yesterday ? { mood: yesterday.ledger.profit >= 0 ? 'happy' : 'sad' } : { greet: 'wave' },
          ),
          h('section', { class: 'desk__choices', 'aria-labelledby': 'decisions-title' }, [
            h('h2', { class: 'section-title', id: 'decisions-title', text: 'Hari ini mau gimana?' }),
            h('div', { class: 'decisions' }, [staffCard, priceCard, stockCard, seatsCard]),
          ]),
        ]),
        h('aside', { class: 'desk__side', 'aria-label': 'Ringkasan pagi' }, [nota, cta]),
      ]),
      shopTeaser,
      queueNotes,
    ]),
  );

  update();

  /**
   * The reputation is explained on the first morning it counts for something:
   * the second, when yesterday's service has moved it and it decides how many
   * come today.
   */
  function showReputation() {
    if (tour) return;
    const chip = document.getElementById('status-reputation');
    if (!chip) return;
    tour = startTour(
      [
        {
          target: chip,
          title: 'Reputasi',
          text:
            `Ini nama baik warungmu, sekarang ${decimal(game.reputation, 0)}. Naik kalau pelanggan cepat dilayani, turun kalau mereka ` +
            'menunggu lama, batal antre, atau tidak kebagian. Makin tinggi, makin banyak yang datang hari ini. Tekan angkanya untuk melihat hitungannya.',
        },
      ],
      {
        onEnd: () => {
          tour = null;
          store.setPrefs({ reputationSeen: true });
        },
      },
    );
  }

  // The very first morning starts with the guide, once the screen has settled.
  if (game.history.length === 0 && !store.prefs.tourSeen) {
    tourTimer = window.setTimeout(showGuide, TOUR_DELAY_MS);
  } else if (game.history.length > 0 && !store.prefs.reputationSeen) {
    tourTimer = window.setTimeout(showReputation, TOUR_DELAY_MS);
  }

  return {
    heading,
    destroy() {
      window.clearTimeout(tourTimer);
      tour?.close();
    },
  };
}
