/**
 * Evening: the report of one day.
 *
 * Everything shown is measured by the simulation of that day: nothing is
 * estimated or smoothed. The queueing metrics carry their usual symbols
 * (ρ, Wq, Lq) next to a plain description, so that a player who goes on to
 * read about queueing theory meets the same names.
 */

import { COSTS, DAY, REPUTATION } from '../game/config.js';
import { EVENT_KIND } from '../game/events.js';
import { STATUS } from '../game/game.js';
import {
  chartsAvailable,
  createChartSet,
  createHourlyChart,
  createProfitChart,
  createReputationChart,
  createWaitChart,
} from './charts.js';
import { dayCalendar } from './calendar.js';
import { createTabs } from './controls.js';
import { h, icon } from './dom.js';
import { countUp, flyCoins, pop, prefersReducedMotion } from './motion.js';
import { play } from './sound.js';
import { CHALLENGE_TEXT, reviewText, EVENT_TEXT, SHOP_NAME } from './text.js';
import { whyPanel, whyTeaser } from './why-view.js';
import {
  clock,
  compact,
  decimal,
  hourRange,
  hourTick,
  integer,
  minutes,
  percent,
  rupiah,
  signed,
  signedRupiah,
} from './format.js';

const sum = (items, key) => items.reduce((total, item) => total + (item[key] ?? 0), 0);

/**
 * A report that has just come out of the day is printed, not merely shown:
 * the receipt feeds out line by line, the stamp comes down, and the coins
 * of the day's result fly to the cash in the header. The times, in
 * milliseconds after the screen appears (the rolling door is still going up
 * for the first of them).
 */
const PRINT_FIRST_LINE_MS = 1300;
const PRINT_LINE_MS = 110;
const STAMP_MS = 1250;
const COINS_MS = 2000;
/** One coin for this much profit or loss, within the limits below. */
const RUPIAH_PER_COIN = 20_000;
const COINS = { min: 4, max: 14 };

/**
 * One row per opening hour, plus one for whatever happened after closing.
 * Customers are counted in the hour in which their visit ended.
 */
export function hourlyRows(report) {
  const { periods } = report.results;
  const rows = periods.slice(0, DAY.hours).map((period, hour) => ({
    label: hourRange(hour),
    tick: hourTick(hour),
    arrivals: period.arrivals,
    served: period.served,
    reneged: period.reneged,
    rejected: period.rejected,
    soldOut: period.soldOut,
    rho: period.rho,
    Lq: period.Lq,
    Wq: period.Wq,
  }));

  const late = periods.slice(DAY.hours);
  if (late.length > 0 && sum(late, 'served') + sum(late, 'reneged') > 0) {
    const staffed = sum(late, 'totalStaffedTime');
    rows.push({
      label: 'setelah tutup',
      tick: 'tutup',
      arrivals: 0,
      served: sum(late, 'served'),
      reneged: sum(late, 'reneged'),
      rejected: 0,
      soldOut: 0,
      rho: staffed > 0 ? sum(late, 'totalBusyTime') / staffed : null,
      Lq: null,
      Wq: null,
    });
  }
  return rows;
}

/** The points behind the day score, as in dayScore() in reputation.js. */
function scoreParts(results) {
  const waiting = results.totalQueueTime / REPUTATION.waitTolerance;
  const turnedAway = results.rejected + results.soldOut;
  return {
    served: results.served,
    waiting,
    reneged: REPUTATION.renegePenalty * results.reneged,
    turnedAway: REPUTATION.turnedAwayPenalty * turnedAway,
    turnedAwayCount: turnedAway,
    points:
      results.served -
      waiting -
      REPUTATION.renegePenalty * results.reneged -
      REPUTATION.turnedAwayPenalty * turnedAway,
  };
}

function resultHero(report, game, fresh) {
  const { ledger, results, reputationBefore, reputationAfter } = report;
  const gain = ledger.profit >= 0;
  const reputationChange = reputationAfter - reputationBefore;
  const fact = (label, value, note) =>
    h('div', { class: 'hero-result__fact' }, [
      h('dt', { text: label }),
      h('dd', {}, [h('span', { class: 'num', text: value }), note && h('small', { text: note })]),
    ]);

  // The amount counts up from zero, like a till being totalled. A loss carries its minus sign.
  const amount = h('p', { class: 'hero-result__amount', 'aria-label': rupiah(ledger.profit) });
  const countDelay = fresh ? 900 : 250;
  // The figure comes sharp over the same second in which it is counted (see ink-settle in app.css).
  amount.style.setProperty('--count-delay', `${countDelay}ms`);
  countUp(amount, Math.abs(ledger.profit), (value) => rupiah(gain ? value : -value), { duration: 1000, delay: countDelay });

  return h('section', { class: `hero-result ${gain ? 'hero-result--gain' : 'hero-result--loss'}`, 'aria-label': 'Hasil hari ini' }, [
    h('div', { class: 'hero-result__main' }, [
      // The stamp beside it says which it was; the words do not say it twice.
      h('p', { class: 'hero-result__label', text: 'Hasil hari ini' }),
      h('span', { class: 'stamp', 'aria-hidden': 'true', text: gain ? 'Laba' : 'Rugi' }),
      amount,
    ]),
    h('dl', { class: 'hero-result__facts' }, [
      fact('Kas sekarang', rupiah(ledger.cashAfter), game.status === STATUS.BANKRUPT && report.day === game.day ? 'kas habis' : null),
      fact(
        'Reputasi',
        // To one decimal, like the change under it, so the two always agree.
        `${decimal(reputationBefore, 1)} → ${decimal(reputationAfter, 1)}`,
        Math.abs(reputationChange) < 0.05 ? 'tetap' : `${signed(reputationChange, 1)} poin`,
      ),
      fact('Dilayani', `${integer(results.served)} dari ${integer(results.arrivals)}`, 'pelanggan yang datang'),
    ]),
  ]);
}

/** The day's event, looked back on: what happened, in one sentence. */
function eventNote(report) {
  const { event } = report;
  if (!event || !EVENT_TEXT[event.id]) return null;
  const text = EVENT_TEXT[event.id];
  const surprise = event.kind === EVENT_KIND.SURPRISE;
  return h('section', { class: surprise ? 'happened happened--surprise' : 'happened', 'aria-label': 'Kejadian hari ini' }, [
    h('h2', { class: 'happened__title' }, [
      h('span', { class: 'happened__icon' }, icon(text.icon)),
      `${surprise ? 'Kejutan' : 'Kabar pagi'}: ${text.name}`,
    ]),
    h('p', { class: 'happened__text', text: text.happened(event) }),
  ]);
}

/** The day's challenge, looked back on: met or not, in one line. A day saved before challenges has none. */
function challengeNote(report) {
  const { challenge } = report;
  if (!challenge || !CHALLENGE_TEXT[challenge.id]) return null;
  return h('p', { class: `challenge ${challenge.met ? 'challenge--met' : 'challenge--missed'}` }, [
    h('span', { class: 'challenge__mark', 'aria-hidden': 'true' }, icon(challenge.met ? 'check' : 'target')),
    h('span', {}, [h('strong', { text: 'Tantangan: ' }), `${CHALLENGE_TEXT[challenge.id]}.`]),
    h('span', { class: 'challenge__prize num', text: challenge.met ? `tercapai, + ${rupiah(report.ledger.stamp)}` : 'belum tercapai' }),
  ]);
}

/**
 * A few of the day's customers, in their own words. Each is a customer the
 * engine simulated: the number, the time they came, how long they waited,
 * and how the visit ended are theirs. Only the sentence is written for them.
 */
function reviewsCard(report) {
  if (!report.reviews?.length) return null;
  return h('section', { class: 'card reviews', 'aria-labelledby': 'reviews-title' }, [
    h('h2', { class: 'card__title', id: 'reviews-title' }, [icon('smile'), 'Kata pelanggan']),
    h(
      'ul',
      { class: 'reviews__list' },
      report.reviews.map((review) =>
        h('li', { class: `review review--${review.kind}` }, [
          h('p', { class: 'review__words', text: `“${reviewText(review)}”` }),
          h('p', { class: 'review__who', text: `Pelanggan ke-${integer(review.customer)}, datang pukul ${clock(review.arrivedAt)}` }),
        ]),
      ),
    ),
    h('p', { class: 'card__note', text: 'Diambil dari pelanggan yang benar-benar disimulasikan hari ini. Lama menunggu dan akhir kunjungannya sesuai catatan mesin.' }),
  ]);
}

function ledgerNota(report) {
  const { ledger, results, decisions, tips } = report;
  const row = (label, amount, note, className = '') =>
    h('div', { class: `nota__row ${className}` }, [
      h('dt', {}, [label, note && h('small', { text: note })]),
      h('dd', { text: amount }),
    ]);
  const profitClass = ledger.profit >= 0 ? 'is-profit' : 'is-loss';

  return h('section', { class: 'nota', 'aria-labelledby': 'ledger-title' }, [
    h('h2', { class: 'nota__title', id: 'ledger-title', text: `Nota hari ke-${report.day}` }),
    h('dl', { class: 'nota__rows' }, [
      row('Pendapatan', rupiah(ledger.revenue), `${integer(results.served)} porsi × ${rupiah(decisions.price)}`),
      // The coins left on the counter, on a day when there were any: also when none was picked up.
      tips?.left > 0 &&
        row('Tip', rupiah(ledger.tips), `${integer(tips.taken)} dari ${integer(tips.left)} koin di konter terpungut`),
      row(
        'Bahan',
        rupiah(-ledger.ingredients),
        results.stockLeft > 0
          ? `${integer(decisions.stock)} porsi, ${integer(results.stockLeft)} terbuang (${rupiah(ledger.waste)})`
          : `${integer(decisions.stock)} porsi, habis terjual`,
      ),
      row(
        'Gaji',
        rupiah(-ledger.wages),
        `${compact(ledger.paidHours ?? results.totalStaffedTime)} jam kerja` +
          (results.overtime > 1 / 60 ? `, termasuk lembur ${minutes(results.overtime, 0)}` : ''),
      ),
      row('Sewa', rupiah(-ledger.rent)),
      h('hr', { class: 'nota__rule' }),
      row(ledger.profit >= 0 ? 'Laba' : 'Rugi', signedRupiah(ledger.profit), null, `nota__row--total ${profitClass}`),
    ]),
    h('dl', { class: 'nota__rows nota__rows--cash' }, [
      row('Kas pagi', rupiah(ledger.cashBefore)),
      ledger.stamp > 0 && row('Cap tantangan', signedRupiah(ledger.stamp), CHALLENGE_TEXT[report.challenge.id].toLowerCase()),
      ledger.purchases > 0 && row(`Belanja di ${SHOP_NAME}`, rupiah(-ledger.purchases), 'bangku, pelatihan, atau peralatan'),
      row('Kas malam', rupiah(ledger.cashAfter), null, 'nota__row--total'),
    ]),
  ]);
}

function customersCard(results) {
  const outcomes = [
    {
      key: 'served',
      count: results.served,
      icon: 'check',
      label: 'Dilayani',
      note: 'makan, bayar, pulang',
    },
    {
      key: 'reneged',
      count: results.reneged,
      icon: 'run',
      label: 'Batal antre',
      note: 'habis sabar saat mengantre (reneging)',
    },
    {
      key: 'balked',
      count: results.rejected,
      icon: 'door',
      label: 'Penuh',
      note: 'bangku tunggu terisi semua, langsung pergi (balking)',
    },
    {
      key: 'soldout',
      count: results.soldOut,
      icon: 'empty',
      label: 'Kehabisan',
      note: 'stok sudah habis',
    },
  ];
  /** "8%", and "<1%" for a share too small to round to one. */
  const share = (count) => {
    const part = results.arrivals > 0 ? count / results.arrivals : 0;
    return count > 0 && part < 0.005 ? '<1%' : percent(part);
  };

  return h('section', { class: 'card', 'aria-labelledby': 'customers-title' }, [
    h('h2', { class: 'card__title', id: 'customers-title' }, [icon('users'), `${integer(results.arrivals)} pelanggan datang`]),
    // The bar repeats the list below it, so it is hidden from assistive technology.
    h(
      'div',
      { class: 'flowbar', 'aria-hidden': 'true' },
      outcomes
        .filter((outcome) => outcome.count > 0)
        .map((outcome) =>
          h('span', { class: `flowbar__part flowbar__part--${outcome.key}`, style: `flex-grow: ${outcome.count}` }),
        ),
    ),
    h(
      'ul',
      { class: 'outcomes' },
      outcomes.map((outcome) =>
        h('li', { class: `outcome outcome--${outcome.key}${outcome.count === 0 ? ' outcome--none' : ''}` }, [
          h('span', { class: 'outcome__mark' }, icon(outcome.icon)),
          h('span', { class: 'outcome__count num', text: integer(outcome.count) }),
          h('span', { class: 'outcome__label' }, [
            h('strong', { text: outcome.label }),
            h('small', { text: `${share(outcome.count)} · ${outcome.note}` }),
          ]),
        ]),
      ),
    ),
    results.soldOutAt !== null &&
      h('p', { class: 'card__note', text: `Stok habis pukul ${clock(results.soldOutAt)}.` }),
  ]);
}

function metricsCard(report, rows) {
  const { results, ledger, decisions } = report;
  const openRows = rows.slice(0, DAY.hours);
  const busiest = openRows.reduce((best, row) => (row.rho > best.rho ? row : best), openRows[0]);
  const longest = openRows.reduce((best, row) => (row.Lq > best.Lq ? row : best), openRows[0]);
  const lost = results.reneged + results.rejected + results.soldOut;

  const metric = ({ symbol, name, value, unit, note }) =>
    h('div', { class: 'metric' }, [
      h('dt', {}, [symbol && h('span', { class: 'chip chip--param', text: symbol }), name]),
      h('dd', {}, [
        h('span', { class: 'metric__value num', text: value }),
        unit && h('span', { class: 'metric__unit', text: unit }),
      ]),
      h('p', { class: 'metric__note', text: note }),
    ]);

  return h('section', { class: 'card', 'aria-labelledby': 'metrics-title' }, [
    h('h2', { class: 'card__title', id: 'metrics-title' }, [icon('clock'), 'Ukuran antrean']),
    h('dl', { class: 'metrics' }, [
      metric({
        symbol: 'ρ',
        name: 'Utilisasi pegawai',
        value: decimal(results.rho, 2),
        note:
          `Rata-rata ${percent(results.rho)} waktu pegawai terpakai melayani. ` +
          `Jam tersibuk ${busiest.label}: ρ ${decimal(busiest.rho, 2)}.`,
      }),
      metric({
        symbol: 'Wq',
        name: 'Rata-rata waktu tunggu',
        value: results.Wq === null ? '-' : decimal(results.Wq * 60, 1),
        unit: 'menit',
        note:
          'Untuk pelanggan yang akhirnya dilayani.' +
          (results.reneged > 0 && results.WqReneged !== null
            ? ` Yang batal antre sempat menunggu rata-rata ${minutes(results.WqReneged)}.`
            : ''),
      }),
      metric({
        symbol: 'Lq',
        name: 'Rata-rata panjang antrean',
        value: decimal(results.Lq, 2),
        unit: 'orang',
        note:
          `Dirata-ratakan sepanjang hari. Paling panjang pada jam ${longest.label}: ` +
          `rata-rata ${decimal(longest.Lq, 2)} orang.`,
      }),
      metric({
        name: 'Pelanggan yang lepas',
        value: integer(lost),
        unit: 'orang',
        note:
          `${integer(results.reneged)} batal antre, ${integer(results.rejected)} penuh, ${integer(results.soldOut)} kehabisan: ` +
          `${percent(results.arrivals > 0 ? lost / results.arrivals : 0)} dari yang datang. ` +
          `Senilai ${rupiah(lost * decisions.price)} kalau semuanya terlayani.`,
      }),
      metric({
        name: 'Pendapatan',
        value: rupiah(ledger.revenue),
        note:
          `${integer(results.served)} porsi terjual dengan harga ${rupiah(decisions.price)}, ` +
          `untung ${rupiah(decisions.price - (report.setup?.ingredientCost ?? COSTS.ingredient))} per porsi di atas modal bahan.`,
      }),
    ]),
  ]);
}

function hourlyTable(rows) {
  const cell = (text) => h('td', { class: 'num', text });
  return h('table', { class: 'table' }, [
    h('caption', { class: 'sr-only', text: 'Pelanggan dan utilisasi tiap jam' }),
    h('thead', {}, [
      h('tr', {}, [
        ...['Jam', 'Datang', 'Dilayani', 'Batal', 'Penuh', 'Kehabisan'].map((text) => h('th', { scope: 'col', text })),
        h('th', { scope: 'col' }, ['ρ']),
        h('th', { scope: 'col' }, ['Wq (menit)']),
      ]),
    ]),
    h(
      'tbody',
      {},
      rows.map((row) =>
        h('tr', {}, [
          h('th', { scope: 'row', text: row.label }),
          cell(integer(row.arrivals)),
          cell(integer(row.served)),
          cell(integer(row.reneged)),
          cell(integer(row.rejected)),
          cell(integer(row.soldOut)),
          cell(row.rho === null ? '-' : decimal(row.rho, 2)),
          cell(row.Wq === null ? '-' : decimal(row.Wq * 60, 1)),
        ]),
      ),
    ),
  ]);
}

function hourlyCard(rows, charts) {
  const openRows = rows.slice(0, DAY.hours);
  const busiest = openRows.reduce((best, row) => (row.rho > best.rho ? row : best), openRows[0]);
  const worst = openRows.reduce(
    (best, row) => (row.reneged + row.rejected > best.reneged + best.rejected ? row : best),
    openRows[0],
  );
  const lostThen = worst.reneged + worst.rejected;
  const summary =
    `Pegawai paling sibuk pada jam ${busiest.label} (ρ ${decimal(busiest.rho, 2)}). ` +
    (lostThen > 0
      ? `Paling banyak pelanggan lepas pada jam ${worst.label}: ${integer(lostThen)} orang.`
      : 'Tidak ada jam yang membuat pelanggan lepas karena antrean.');

  const canvas = h('canvas', { role: 'img', 'aria-label': `Grafik batang pelanggan tiap jam dan garis utilisasi. ${summary}` });
  const figure = h('div', { class: 'chart chart--tall', hidden: !chartsAvailable() }, canvas);
  charts.add(() => createHourlyChart(canvas, rows));

  return h('section', { class: 'card', 'aria-labelledby': 'hourly-title' }, [
    h('h2', { class: 'card__title', id: 'hourly-title' }, [icon('sun'), 'Jam demi jam']),
    h('p', { class: 'chart__summary', text: summary }),
    figure,
    h('details', { class: 'details', open: !chartsAvailable() }, [
      h('summary', { text: 'Lihat angkanya dalam tabel' }),
      h('div', { class: 'table-scroll' }, hourlyTable(rows)),
    ]),
  ]);
}

function reputationCard(report) {
  const { results, score, reputationBefore, reputationAfter } = report;
  const parts = scoreParts(results);
  const line = (sign, amount, text) =>
    h('li', { class: 'score__line' }, [
      h('span', { class: `score__amount num ${sign === '+' ? 'is-profit' : 'is-loss'}`, text: `${sign === '+' ? '+' : '−'}${decimal(amount, 1)}` }),
      h('span', { text }),
    ]);
  const marker = (value, className, label) =>
    h('span', { class: `meter__marker ${className}`, style: `left: ${value}%`, title: label });

  return h('section', { class: 'card', 'aria-labelledby': 'reputation-title' }, [
    h('h2', { class: 'card__title', id: 'reputation-title' }, [icon('star'), 'Reputasi']),
    score === null
      ? h('p', { text: 'Tidak ada pelanggan hari ini, jadi tidak ada yang bercerita. Reputasi tetap.' })
      : [
          h('ul', { class: 'score' }, [
            line('+', parts.served, `${integer(results.served)} pelanggan dilayani`),
            line(
              '-',
              parts.waiting,
              `waktu menunggu: ${decimal(results.totalQueueTime * 60, 0)} menit antre seluruh pelanggan ÷ ${decimal(REPUTATION.waitTolerance * 60, 0)}`,
            ),
            line('-', parts.reneged, `${integer(results.reneged)} pelanggan batal antre × ${decimal(REPUTATION.renegePenalty, 0)}`),
            line(
              '-',
              parts.turnedAway,
              `${integer(parts.turnedAwayCount)} pelanggan ditolak (penuh atau kehabisan) × ${decimal(REPUTATION.turnedAwayPenalty, 1)}`,
            ),
          ]),
          h('p', { class: 'score__total' }, [
            h('span', { class: 'num', text: `${decimal(Math.max(parts.points, 0), 1)} poin ÷ ${integer(results.arrivals)} pelanggan × 100` }),
            ' = skor hari ini ',
            h('strong', { class: 'num', text: decimal(score, 0) }),
          ]),
        ],
    h('div', { class: 'meter', role: 'img', 'aria-label': `Reputasi ${decimal(reputationBefore, 0)} menjadi ${decimal(reputationAfter, 0)} dari 100` }, [
      h('span', { class: 'meter__fill', style: `width: ${reputationAfter}%` }),
      marker(reputationBefore, 'meter__marker--before', 'pagi'),
      score !== null && marker(score, 'meter__marker--score', 'skor hari ini'),
    ]),
    h('p', { class: 'legend', 'aria-hidden': 'true' }, [
      h('span', { class: 'legend__item' }, [h('span', { class: 'legend__swatch legend__swatch--fill' }), `reputasi malam ini ${decimal(reputationAfter, 0)}`]),
      h('span', { class: 'legend__item' }, [h('span', { class: 'legend__swatch legend__swatch--mark' }), `pagi tadi ${decimal(reputationBefore, 0)}`]),
      score !== null &&
        h('span', { class: 'legend__item' }, [h('span', { class: 'legend__swatch legend__swatch--mark legend__swatch--dotted' }), `skor hari ini ${decimal(score, 0)}`]),
    ]),
    h('p', {
      class: 'card__note',
      text:
        score === null
          ? `Reputasi ${decimal(reputationAfter, 0)}.`
          : `Reputasi bergerak ${percent(REPUTATION.memory)} dari jarak ke skor hari ini: ` +
            `${decimal(reputationBefore, 1)} → ${decimal(reputationAfter, 1)}. ` +
            'Makin tinggi reputasi, makin banyak pelanggan yang datang besok.',
    }),
  ]);
}

/** Profit, reputation, and waiting time across the days played so far. */
export function trendsCard(history, charts) {
  const profits = history.map((report) => report.ledger.profit);
  const reputations = history.map((report) => report.reputationAfter);
  const waits = history.map((report) => (report.results.Wq ?? 0) * 60);
  const available = chartsAvailable();

  const chart = (title, label, create, values) => {
    const canvas = h('canvas', { role: 'img', 'aria-label': label });
    charts.add(() => create(canvas, values));
    return h('figure', { class: 'trend' }, [
      h('figcaption', { text: title }),
      h('div', { class: 'chart chart--short', hidden: !available }, canvas),
    ]);
  };
  const last = history.at(-1);
  const total = profits.reduce((sumSoFar, profit) => sumSoFar + profit, 0);
  const summary =
    history.length === 1
      ? 'Baru satu hari. Garisnya mulai terbentuk besok.'
      : `Dalam ${history.length} hari: laba bersih ${signedRupiah(total)}, reputasi dari ${decimal(history[0].reputationBefore, 0)} ke ${decimal(last.reputationAfter, 0)}.`;

  return h('section', { class: 'card', 'aria-labelledby': 'trends-title' }, [
    h('h2', { class: 'card__title', id: 'trends-title' }, [icon('up'), 'Dari hari ke hari']),
    h('p', { class: 'chart__summary', text: summary }),
    h('div', { class: 'trends' }, [
      chart('Laba per hari', `Grafik batang laba per hari. ${summary}`, createProfitChart, profits),
      chart('Reputasi', 'Grafik garis reputasi tiap akhir hari, skala 0 sampai 100.', createReputationChart, reputations),
      chart('Rata-rata waktu tunggu (menit)', 'Grafik garis rata-rata waktu tunggu pelanggan yang dilayani, tiap hari.', createWaitChart, waits),
    ]),
    h('details', { class: 'details', open: !available }, [
      h('summary', { text: 'Lihat angkanya dalam tabel' }),
      h('div', { class: 'table-scroll' }, [
        h('table', { class: 'table' }, [
          h('caption', { class: 'sr-only', text: 'Laba, reputasi, dan waktu tunggu tiap hari' }),
          h('thead', {}, [
            h('tr', {}, ['Hari', 'Laba', 'Reputasi', 'Tunggu (menit)', 'Batal', 'Penuh'].map((text) => h('th', { scope: 'col', text }))),
          ]),
          h(
            'tbody',
            {},
            history.map((report) =>
              h('tr', {}, [
                h('th', { scope: 'row' }, h('a', { href: `#/laporan/${report.day}`, text: `Hari ${report.day}` })),
                h('td', { class: `num ${report.ledger.profit >= 0 ? 'is-profit' : 'is-loss'}`, text: signedRupiah(report.ledger.profit) }),
                h('td', { class: 'num', text: decimal(report.reputationAfter, 0) }),
                h('td', { class: 'num', text: report.results.Wq === null ? '-' : decimal(report.results.Wq * 60, 1) }),
                h('td', { class: 'num', text: integer(report.results.reneged) }),
                h('td', { class: 'num', text: integer(report.results.rejected) }),
              ]),
            ),
          ),
        ]),
      ]),
    ]),
  ]);
}

export function renderReport(container, { store }, day) {
  const { game } = store;
  const report = game.history[day - 1];
  const isLatest = day === game.history.length;
  const rows = hourlyRows(report);
  // Set when the day ends (see completeDay in app.js), and used up here.
  const fresh = store.session.freshReport === day;
  if (fresh) store.remember({ freshReport: null });
  const timers = [];
  const later = (ms, run) => timers.push(window.setTimeout(run, ms));
  // A chart measures its panel when it is built, so the charts of a tab are
  // built the first time that tab is shown, not while it is still hidden.
  const charts = { antrean: createChartSet(), perjalanan: createChartSet() };

  let next;
  if (!isLatest) {
    next = h('a', { class: 'btn btn--primary', href: `#/laporan/${game.history.length}` }, ['Ke laporan terakhir', icon('chevron-right')]);
  } else if (game.status === STATUS.PLAYING) {
    next = h('a', { class: 'btn btn--primary', href: '#/pagi' }, [icon('sun'), `Siapkan hari ke-${game.day}`]);
  } else {
    next = h('a', { class: 'btn btn--primary', href: '#/akhir' }, ['Lihat hasil akhir', icon('chevron-right')]);
  }

  const heading = h('h1', { id: 'view-title', tabindex: '-1', text: `Laporan hari ke-${report.day}` });
  const tabs = createTabs({
    label: 'Bagian laporan',
    selected: store.session.reportTab,
    tabs: [
      {
        id: 'ringkasan',
        label: 'Ringkasan',
        icon: 'book',
        panel: [
          eventNote(report),
          whyTeaser(report, () => tabs.select('kenapa', { focus: true })),
          challengeNote(report),
          h('div', { class: 'report__pair' }, [ledgerNota(report), customersCard(report.results)]),
          reviewsCard(report),
        ],
      },
      {
        // The day explained in the terms of queueing theory.
        id: 'kenapa',
        label: 'Kenapa?',
        icon: 'info',
        panel: [whyPanel(report, { canShop: game.status === STATUS.PLAYING })],
      },
      {
        id: 'antrean',
        label: 'Antrean',
        icon: 'clock',
        panel: [metricsCard(report, rows), hourlyCard(rows, charts.antrean)],
      },
      {
        id: 'perjalanan',
        label: 'Tren',
        icon: 'up',
        panel: [reputationCard(report), trendsCard(game.history.slice(0, day), charts.perjalanan)],
      },
    ],
    onSelect: (id) => {
      // Called once while the tabs are being built, before they are on the
      // page; those charts are built at the end of this function instead.
      if (heading.isConnected) charts[id]?.mount();
      store.remember({ reportTab: id });
    },
  });

  container.append(
    h('section', { class: 'view view--malam', 'aria-labelledby': 'view-title' }, [
      h('header', { class: 'view__head' }, [heading, dayCalendar(game, { selected: day })]),
      h('div', { class: 'report' }, [
        resultHero(report, game, fresh),
        tabs.list,
        ...tabs.panels,
        h('div', { class: 'report__next' }, next),
      ]),
    ]),
  );

  charts[store.session.reportTab]?.mount();

  if (fresh && !prefersReducedMotion()) {
    const { profit } = report.ledger;
    const nota = container.querySelector('.nota');
    // The receipt is printed: each line in turn, with the sound of the printer.
    nota.classList.add('nota--printing');
    nota.querySelectorAll('.nota__row, .nota__rule').forEach((line, i) => {
      line.style.setProperty('--line', String(i));
      later(PRINT_FIRST_LINE_MS + i * PRINT_LINE_MS, () => play('print'));
    });
    later(STAMP_MS, () => play(profit >= 0 ? 'profit' : 'loss'));

    // The day's result goes into the till (or, after a loss, out of it).
    later(COINS_MS, () => {
      const amount = container.querySelector('.hero-result__amount');
      const cash = document.querySelector('#status-cash dd');
      const count = Math.min(Math.max(Math.round(Math.abs(profit) / RUPIAH_PER_COIN), COINS.min), COINS.max);
      const arrived = () => {
        play('coin');
        pop(profit >= 0 ? cash : amount);
      };
      if (profit >= 0) flyCoins(amount, cash, { count, onArrive: arrived });
      else flyCoins(cash, amount, { count, lost: true, onArrive: arrived });
    });
  } else if (fresh) {
    play(report.ledger.profit >= 0 ? 'profit' : 'loss');
  }

  return {
    heading,
    destroy() {
      timers.forEach((timer) => window.clearTimeout(timer));
      charts.antrean.destroy();
      charts.perjalanan.destroy();
    },
  };
}
