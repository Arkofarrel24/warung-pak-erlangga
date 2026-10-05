/**
 * The fourteen days of the game as a wall calendar.
 *
 * Each day that has been played carries a stamp, plus for a profit and minus
 * for a loss, and the mark of whatever happened that day. A stamped day opens
 * its report, so the calendar is also the way from one report to another.
 */

import { DAY, RENT_RISE } from '../game/config.js';
import { STATUS } from '../game/game.js';
import { h, icon } from './dom.js';
import { rupiah, shortRupiah } from './format.js';
import { EVENT_TEXT } from './text.js';

/**
 * @param {object} game
 * @param {object} [options]
 * @param {number} [options.selected] the day whose report is on screen
 * @param {boolean} [options.planning] the screen is today's morning
 */
export function dayCalendar(game, { selected = null, planning = false } = {}) {
  const playing = game.status === STATUS.PLAYING;

  const cell = (day) => {
    const report = game.history[day - 1];
    const number = h('span', { class: 'cal__number', text: String(day) });
    // The day the rent goes up is marked from the start, so it can be planned for.
    const rentRises = day === RENT_RISE.fromDay;
    const rentMark = rentRises && h('span', { class: 'cal__rent', title: 'Sewa naik mulai hari ini' }, icon('up'));
    const rentNote = rentRises ? ', sewa naik mulai hari ini' : '';

    if (report) {
      const { profit } = report.ledger;
      const gain = profit >= 0;
      const happened = report.event && EVENT_TEXT[report.event.id];
      const label =
        `Hari ${day}: ${gain ? 'laba' : 'rugi'} ${rupiah(Math.abs(profit))}` +
        (happened ? `, ${happened.name.toLowerCase()}` : '') +
        `${rentNote}. Buka laporannya.`;
      return h(
        'a',
        {
          class: [
            'cal__day',
            gain ? 'cal__day--gain' : 'cal__day--loss',
            // The stamp lands on the day that has just been closed.
            day === game.history.length && day === selected ? 'cal__day--fresh' : '',
          ].join(' '),
          href: `#/laporan/${day}`,
          'aria-label': label,
          'aria-current': day === selected ? 'page' : null,
          title: label,
        },
        [
          number,
          h('span', { class: 'cal__stamp' }, icon(gain ? 'plus' : 'minus')),
          h('span', { class: 'cal__amount num', text: shortRupiah(Math.abs(profit)).replace(/^Rp\s/, '') }),
          happened && h('span', { class: 'cal__event' }, icon(happened.icon)),
          rentMark,
        ],
      );
    }

    if (playing && day === game.day) {
      return h(
        'a',
        {
          class: 'cal__day cal__day--today',
          href: '#/pagi',
          'aria-label': `Hari ${day}: hari ini${rentNote}`,
          'aria-current': planning ? 'page' : null,
        },
        // On a narrow screen the cell has no room for the words, so a sun stands in for them.
        [number, icon('sun', 'icon cal__today-icon'), h('span', { class: 'cal__today', text: 'hari ini' }), rentMark],
      );
    }

    return h('span', { class: 'cal__day cal__day--ahead', 'aria-label': `Hari ${day}: belum dijalani${rentNote}` }, [number, rentMark]);
  };

  return h(
    'nav',
    { class: 'cal', 'aria-label': `Kalender ${DAY.count} hari` },
    h(
      'ol',
      { class: 'cal__days' },
      Array.from({ length: DAY.count }, (_, i) => h('li', {}, cell(i + 1))),
    ),
  );
}
