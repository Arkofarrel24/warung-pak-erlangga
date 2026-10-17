/** The end of a game: fourteen days survived, or the cash ran out. */

import { DAY, STARS, START } from '../game/config.js';
import { stars, STATUS } from '../game/game.js';
import { dayCalendar } from './calendar.js';
import { createChartSet } from './charts.js';
import { h, icon } from './dom.js';
import { decimal, integer, percent, rupiah, signedRupiah, spokenRupiah } from './format.js';
import { confetti, prefersReducedMotion } from './motion.js';
import { avatar, bubble } from './pak-erlangga.js';
import { trendsCard } from './report-view.js';
import { play } from './sound.js';

const total = (history, pick) => history.reduce((sum, report) => sum + pick(report), 0);

/** What a game is called on its certificate, by the stars it earned. */
const TITLES = ['Belum Rezeki', 'Penjaga Warung', 'Pengelola Cekatan', 'Juragan Warung'];
/** How long after the screen appears the first star lands, and how long between stars, in milliseconds. */
const FIRST_STAR_MS = 700;
const STAR_GAP_MS = 420;

/**
 * The certificate: the stars, a title to go with them, the numbers of the
 * game, and room for a name. It is laid out to be kept, as a screenshot.
 */
function certificate(store, { earned, facts, fresh }) {
  // Days whose challenge was met, of the days that had one (a game saved before challenges has none).
  const judged = store.game.history.filter((report) => report.challenge);
  const caps = { met: judged.filter((report) => report.challenge.met).length, total: judged.length };
  const { game } = store;
  const won = game.status === STATUS.WON;
  const animate = fresh && !prefersReducedMotion();

  const starRow = h(
    'p',
    { class: 'piagam__stars', role: 'img', 'aria-label': `${earned} dari 3 bintang` },
    [1, 2, 3].map((n) => {
      const star = icon('star', n <= earned ? 'piagam__star piagam__star--on' : 'piagam__star');
      if (n <= earned && animate) {
        // Each star lands in turn, with a note of its own.
        const delay = FIRST_STAR_MS + (n - 1) * STAR_GAP_MS;
        star.style.animationDelay = `${delay}ms`;
        star.classList.add('piagam__star--landing');
        window.setTimeout(() => play('star'), delay);
      }
      return star;
    }),
  );

  const name = h('input', {
    class: 'piagam__name',
    type: 'text',
    id: 'piagam-name',
    maxlength: '28',
    autocomplete: 'name',
    spellcheck: 'false',
    placeholder: 'Tulis namamu di sini',
    value: store.prefs.name ?? '',
  });
  name.addEventListener('input', () => store.setPrefs({ name: name.value }));

  let next = null;
  if (won && earned < 3) {
    const target = earned === 1 ? STARS.two : STARS.three;
    next = `Bintang berikutnya butuh kas akhir ${rupiah(target)}. Kurang ${rupiah(target - game.cash)} lagi.`;
  } else if (!won) {
    next = `Bertahan sampai hari ke-${DAY.count} untuk bintang pertama.`;
  }

  return h('section', { class: `piagam piagam--${earned}`, 'aria-labelledby': 'piagam-title' }, [
    h('div', { class: 'piagam__frame' }, [
      h('p', { class: 'piagam__kicker', text: 'Piagam Warung Pak Erlangga' }),
      starRow,
      h('h2', { class: 'piagam__title', id: 'piagam-title', text: TITLES[earned] }),
      h('label', { class: 'piagam__to', for: 'piagam-name', text: 'diberikan kepada' }),
      name,
      h('p', {
        class: 'piagam__for',
        text: won
          ? `yang menjaga warung selama ${DAY.count} hari sampai tutup buku`
          : `yang menjaga warung selama ${game.history.length} hari sebelum kasnya habis`,
      }),
      h(
        'dl',
        { class: 'piagam__facts' },
        facts.map(([label, value, note]) =>
          h('div', { class: 'piagam__fact' }, [
            h('dt', { text: label }),
            h('dd', {}, [h('span', { class: 'num', text: value }), h('small', { text: note })]),
          ]),
        ),
      ),
      caps.total > 0 && h('p', { class: 'piagam__caps', text: `Cap tantangan: ${integer(caps.met)} dari ${integer(caps.total)} hari` }),
      h('div', { class: 'piagam__sign' }, [
        avatar({ mood: won ? 'happy' : 'sad' }),
        h('p', {}, [h('strong', { text: 'Pak Erlangga' }), h('small', { text: 'pemilik lama' })]),
      ]),
    ]),
    next && h('p', { class: 'piagam__next', text: next }),
  ]);
}

export function renderEnd(container, { store, startNewGame }) {
  const { game } = store;
  const { history } = game;
  const won = game.status === STATUS.WON;
  const earned = stars(game);
  const charts = createChartSet();
  // Once per game, not on every later visit to this screen.
  const fresh = store.session.celebrated !== game.seed;

  const arrivals = total(history, (report) => report.results.arrivals);
  const served = total(history, (report) => report.results.served);
  const reneged = total(history, (report) => report.results.reneged);
  const profit = total(history, (report) => report.ledger.profit);
  const tips = total(history, (report) => report.ledger.tips ?? 0);
  const spent = total(history, (report) => report.ledger.purchases ?? 0);
  const best = history.reduce((top, report) => (report.ledger.profit > top.ledger.profit ? report : top), history[0]);

  let words;
  if (!won) {
    words =
      `Kasnya habis di hari ke-${game.day}, jadi warung terpaksa tutup. Coba buka lagi laporan hari-hari terakhir: ` +
      'biasanya jawabannya ada di antrean, harga, atau stok.';
  } else if (earned === 3) {
    words = `Empat belas hari, dan kasnya jadi ${spokenRupiah(game.cash)}. Saya saja dulu tidak sepandai ini. Warungnya saya titipkan ke orang yang tepat!`;
  } else if (earned === 2) {
    words = `Empat belas hari, dan kasnya jadi ${spokenRupiah(game.cash)}, lebih dari dua kali modal. Bagus! Sedikit lagi jadi juragan.`;
  } else {
    words =
      `Empat belas hari, dan warungnya masih berdiri dengan kas ${spokenRupiah(game.cash)}. ` +
      (game.cash >= START.cash ? 'Selamat! ' : 'Selamat, walau kasnya menyusut. ') +
      'Warung ini masih bisa untung lebih banyak. Coba lagi dengan pegawai, harga, atau stok yang berbeda.';
  }

  const heading = h('h1', { id: 'view-title', tabindex: '-1', text: won ? 'Warung bertahan' : 'Warung tutup' });
  container.append(
    h('section', { class: 'view view--akhir', 'aria-labelledby': 'view-title' }, [
      h('header', { class: 'view__head' }, [
        heading,
        bubble(h('p', { text: words }), { mood: earned >= 2 ? 'happy' : won ? undefined : 'sad', greet: earned >= 2 ? 'cheer' : 'talk' }),
      ]),
      // The certificate is what the game ends on; the days behind it follow.
      certificate(store, {
        earned,
        fresh,
        facts: [
          // Cash at the end = the starting capital + net profit - what was spent next door.
          [
            'Kas akhir',
            rupiah(game.cash),
            spent > 0
              ? `modal ${rupiah(START.cash)} + laba − belanja toko ${rupiah(spent)}`
              : `modal awal ${rupiah(START.cash)}`,
          ],
          // The profit of the fourteen days of selling: what was bought next door is not in it.
          [
            'Laba dari jualan',
            signedRupiah(profit),
            [tips > 0 && `termasuk tip ${rupiah(tips)}`, spent > 0 && 'belum dikurangi belanja toko', `hari terbaik: hari ke-${best.day}`]
              .filter(Boolean)
              .join(', '),
          ],
          ['Reputasi', decimal(game.reputation, 0), 'dari 100, mulai dari 50'],
          [
            'Pelanggan dilayani',
            integer(served),
            `${percent(arrivals > 0 ? served / arrivals : 0)} dari ${integer(arrivals)} yang datang, ${integer(reneged)} batal antre`,
          ],
        ],
      }),
      // What to do next comes right under the certificate, where the line about the next star has just been read.
      h('div', { class: 'report__next' }, [
        h('a', { class: 'btn', href: `#/laporan/${history.length}` }, [icon('book'), 'Buka laporan hari terakhir']),
        // On paper, or as a PDF, the page is the certificate alone (see the print rules in app.css).
        h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, [icon('book'), 'Cetak atau simpan piagam']),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => startNewGame({ confirm: false }) }, [
          icon('refresh'),
          'Main lagi',
        ]),
      ]),
      dayCalendar(game),
      trendsCard(history, charts),
    ]),
  );
  charts.mount();

  if (fresh) {
    store.remember({ celebrated: game.seed });
    if (earned >= 2) {
      const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      // The confetti goes off as the last star lands.
      window.setTimeout(
        () => {
          confetti(['--kunyit', '--bata', '--daun', '--biru', '--krem'].map(token));
          play('win');
        },
        prefersReducedMotion() ? 0 : FIRST_STAR_MS + earned * STAR_GAP_MS,
      );
    }
  }

  return { heading, destroy: () => charts.destroy() };
}
