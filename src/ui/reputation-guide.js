/**
 * What the reputation is and what moves it, in words.
 *
 * Every number shown is read from the rules of the game (REPUTATION and
 * DEMAND in config.js), so the explanation cannot drift away from what the
 * game actually does:
 *
 *   - the day's points: +1 per customer served, less the waiting, the
 *     reneging, and those turned away (dayScore in reputation.js);
 *   - exponential smoothing: the reputation moves a fixed share of the way
 *     toward the day's score (nextReputation);
 *   - the reputation scales tomorrow's arrival rate λ(t) (reputationFactor
 *     in demand.js).
 *
 * It is shown in three places: when the figure in the header is pressed, as
 * a step of the first-day tour, and under "Cara main" on the front page.
 */

import { REPUTATION } from '../game/config.js';
import { reputationFactor } from '../game/demand.js';
import { infoDialog } from './controls.js';
import { h } from './dom.js';
import { compact, percent } from './format.js';

const MINUS = '−';

/** The explanation as a block of content, for wherever it is shown. */
export function reputationRules() {
  const rule = (points, text) =>
    h('li', { class: 'rep-guide__rule' }, [
      h('span', {
        class: `rep-guide__points num ${points > 0 ? 'rep-guide__points--up' : 'rep-guide__points--down'}`,
        text: `${points > 0 ? '+' : MINUS}${compact(Math.abs(points))}`,
      }),
      h('span', { text }),
    ]);
  const step = (lead, text) => h('p', {}, [h('strong', { text: `${lead} ` }), text]);

  const usual = reputationFactor(REPUTATION.start);
  const more = reputationFactor(100) / usual - 1;
  const fewer = reputationFactor(0) / usual;

  return h('div', { class: 'rep-guide' }, [
    h('p', {
      text:
        'Reputasi adalah nama baik warungmu, dari 0 sampai 100. Tiap malam ia dihitung ulang dari ' +
        'cara pelanggan hari itu diperlakukan.',
    }),
    h('h3', { class: 'rep-guide__title', text: 'Poin hari itu' }),
    h('ul', { class: 'rep-guide__rules' }, [
      rule(1, 'tiap pelanggan yang dilayani'),
      rule(-1, `tiap ${compact(REPUTATION.waitTolerance * 60)} menit menunggu, dijumlah dari semua pelanggan`),
      rule(-REPUTATION.renegePenalty, 'tiap orang yang batal antre karena kelamaan'),
      rule(-REPUTATION.turnedAwayPenalty, 'tiap orang yang balik kanan karena bangku penuh, atau kehabisan masakan'),
    ]),
    step('Skor hari itu.', 'Poinnya dibagi jumlah pelanggan yang datang, lalu dikali 100. Hasilnya angka dari 0 sampai 100.'),
    step(
      'Bergesernya pelan.',
      `Reputasi bergerak ${percent(REPUTATION.memory)} ke arah skor itu. Satu hari buruk terasa, tapi tidak langsung ` +
        'menghancurkan; satu hari bagus juga belum cukup.',
    ),
    step(
      'Akibatnya besok.',
      `Di reputasi ${compact(REPUTATION.start)} yang datang seperti biasa. Di reputasi 100 kira-kira ${percent(more)} lebih banyak, ` +
        `dan di reputasi 0 tinggal ${percent(fewer)}-nya.`,
    ),
    h('p', {
      class: 'rep-guide__note',
      text:
        'Singkatnya: layani sebanyak mungkin, secepat mungkin, dan jangan sampai kehabisan. ' +
        'Hitungan tiap hari ada di laporan malam, tab Tren.',
    }),
  ]);
}

/**
 * Opens the explanation as a dialog.
 *
 * @param {Event} [event] the press that asked for it; the focus goes back to what was pressed
 */
export function showReputationGuide(event) {
  infoDialog({ title: 'Reputasi itu apa?', body: reputationRules(), opener: event?.currentTarget ?? undefined });
}
