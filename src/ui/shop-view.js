/**
 * The shop next door: where the warung's equipment is bought.
 *
 * It edits the same draft as the morning screen (see draft.js). Nothing is
 * paid for here: what is in the basket is paid when the warung opens, so
 * anything can still be put back. Every card shows what the purchase changes
 * as a number before and after, taken from the same arithmetic the game
 * itself uses.
 */

import { LIMITS, SEAT_COST, TRAINING, UPGRADES } from '../game/config.js';
import { wagePerHour } from '../game/day.js';
import { createStepper } from './controls.js';
import { h, icon } from './dom.js';
import { basketCount, draftFacts, loadDraft, saveDraft, setSeatsBought, toggleUpgrade } from './draft.js';
import { compact, integer, rupiah } from './format.js';
import { createLiveNumbers, pop, tilt } from './motion.js';
import { bubble, speak } from './pak-erlangga.js';
import { play } from './sound.js';
import { startTour } from './tour.js';
import { pick, SEAT_TEXT, SHOP_NAME, SHOP_WORDS, trainingText, UPGRADE_TEXT } from './text.js';

/** The draft as it would be with one thing changed, leaving the real draft alone. */
function imagine(draft, change) {
  const copy = structuredClone(draft);
  change(copy);
  return copy;
}

export function renderShop(container, { store }) {
  const { game } = store;
  const draft = loadDraft(store);
  const live = createLiveNumbers();
  /** What each item on the shelf needs redrawn when the basket changes. */
  const shelf = [];

  const words = h('p');
  const speech = bubble(words);
  /** Pak Erlangga says something new, with a gesture to go with it. */
  const say = (text, how = 'talk') => {
    if (words.textContent === text) return;
    words.textContent = text;
    pop(words);
    speak(speech, how);
  };

  // --- The wallet -------------------------------------------------------------

  const wallet = {
    cash: h('dd', { class: 'num' }),
    basket: h('dd', { class: 'num' }),
    stock: h('dd', { class: 'num' }),
    left: h('dd', { class: 'num' }),
  };
  const stockLabel = h('dt');
  const walletNote = h('p', { class: 'wallet-note', role: 'status' });
  const walletBar = h('section', { class: 'wallet', 'aria-label': 'Dompet dan keranjang' }, [
    h('dl', { class: 'wallet__figures' }, [
      h('div', { class: 'wallet__figure' }, [h('dt', {}, [icon('wallet'), 'Kas pagi ini']), wallet.cash]),
      h('div', { class: 'wallet__figure' }, [h('dt', {}, [icon('basket'), 'Keranjang']), wallet.basket]),
      h('div', { class: 'wallet__figure' }, [stockLabel, wallet.stock]),
      h('div', { class: 'wallet__figure wallet__figure--left' }, [h('dt', {}, [icon('tag'), 'Sisa kas']), wallet.left]),
    ]),
  ]);

  // --- The shelf --------------------------------------------------------------

  /**
   * One thing for sale.
   *
   * @param {object} item
   * @param {string} item.id
   * @param {object} item.text          name, icon, effect, quips
   * @param {number} item.cost          the price of one
   * @param {boolean} item.owned        already bought on an earlier day
   * @param {string} [item.ownedLabel]
   * @param {() => boolean} item.inBasket
   * @param {() => void} item.toggle
   * @param {(facts: object) => Array} item.change what it changes, as nodes
   * @param {Node} [item.extra]         shown under the name (training pips)
   */
  function shelfItem({ id, text, cost, owned, ownedLabel = 'Sudah punya', inBasket, toggle, change, extra }) {
    const changeLine = h('p', { class: 'ware__change' });
    const button = h('button', { type: 'button', class: 'btn ware__buy' });
    const reason = h('p', { class: 'ware__reason', id: `ware-${id}-reason` });
    const ribbon = h('span', { class: 'ware__ribbon', hidden: true }, [icon('check'), 'Di keranjang']);
    const card = h('li', { class: 'card ware' }, [
      ribbon,
      h('div', { class: 'ware__top' }, [
        h('span', { class: 'ware__icon' }, icon(text.icon)),
        // Paid for on an earlier day: the tag says so, the line under the card says what it is.
        h('span', { class: 'ware__price num' }, owned ? 'Lunas' : rupiah(cost)),
      ]),
      h('h2', { class: 'ware__name', text: text.name }),
      extra,
      h('p', { class: 'ware__effect', text: text.effect }),
      changeLine,
      owned
        ? h('p', { class: 'ware__owned' }, [icon('check'), ownedLabel])
        : [button, reason],
    ]);

    if (!owned) {
      button.setAttribute('aria-describedby', reason.id);
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true') return;
        toggle();
        play(inBasket() ? 'buy' : 'putBack');
        say(pick(inBasket() ? text.quips : SHOP_WORDS.putBack, words.textContent), inBasket() ? 'cheer' : 'talk');
        update();
        pop(card);
      });
    }

    shelf.push((facts) => {
      changeLine.replaceChildren(...change(facts));
      if (owned) return;
      const chosen = inBasket();
      // What is left for this item once everything else in the basket is paid for.
      const spare = game.cash - facts.purchases + (chosen ? cost : 0);
      const affordable = chosen || cost <= spare;
      card.classList.toggle('ware--chosen', chosen);
      ribbon.hidden = !chosen;
      button.setAttribute('aria-pressed', String(chosen));
      button.setAttribute('aria-disabled', String(!affordable));
      button.replaceChildren(
        icon(chosen ? 'x' : 'basket'),
        h('span', { text: chosen ? 'Keluarkan lagi' : 'Masukkan keranjang' }),
      );
      reason.textContent = affordable ? '' : `Kasmu kurang ${rupiah(cost - spare)}.`;
    });
    return card;
  }

  // The arrow never ends a line: it stays with what comes after it. The unit is kept in one piece.
  const beforeAfter = (key, label, before, after, unit = '') => [
    `${label}: `,
    h('span', { class: 'ware__before', text: before }),
    ' ',
    h('span', { class: 'ware__pair' }, ['→ ', live(key, after)]),
    unit && ` ${unit.replaceAll(' ', '\u00a0')}`,
  ];

  // Stools: bought by the piece.
  const seatsLeft = LIMITS.seats.max - game.seatsOwned;
  const seatStepper = createStepper({
    id: 'buy-seats',
    name: 'bangku yang dibeli',
    value: draft.buy.seats,
    min: 0,
    max: seatsLeft,
    suffix: 'bangku',
    onChange: (value) => {
      const added = value > draft.buy.seats;
      setSeatsBought(game, draft, value);
      play(added ? 'buy' : 'putBack');
      say(added ? pick(SEAT_TEXT.quips, words.textContent) : SHOP_WORDS.seatBack, added ? 'cheer' : 'talk');
      update();
    },
  });
  const seatChange = h('p', { class: 'ware__change' });
  const seatReason = h('p', { class: 'ware__reason' });
  const seatRibbon = h('span', { class: 'ware__ribbon', hidden: true });
  const seatCard = h('li', { class: 'card ware' }, [
    seatRibbon,
    h('div', { class: 'ware__top' }, [
      h('span', { class: 'ware__icon' }, icon(SEAT_TEXT.icon)),
      h('span', { class: 'ware__price num' }, seatsLeft > 0 ? [rupiah(SEAT_COST), h('small', { text: ' / bangku' })] : 'Sudah penuh'),
    ]),
    h('h2', { class: 'ware__name', text: SEAT_TEXT.name }),
    h('p', { class: 'ware__effect', text: SEAT_TEXT.effect }),
    seatChange,
    seatsLeft > 0
      ? [h('label', { class: 'sr-only', for: 'buy-seats', text: 'Jumlah bangku yang dibeli' }), seatStepper.element, seatReason]
      : h('p', { class: 'ware__owned' }, [icon('check'), `Warung hanya muat ${LIMITS.seats.max} bangku`]),
  ]);
  shelf.push((facts) => {
    const bought = draft.buy.seats;
    // With nothing in the basket there is no change to show, only what is owned.
    seatChange.replaceChildren(
      ...(bought > 0
        ? beforeAfter('seats', 'Bangku milikmu', integer(game.seatsOwned), integer(game.seatsOwned + bought))
        : [`Bangku milikmu: ${integer(game.seatsOwned)}`]),
    );
    seatCard.classList.toggle('ware--chosen', bought > 0);
    seatRibbon.hidden = bought === 0;
    seatRibbon.replaceChildren(icon('check'), `${bought} di keranjang`);
    // No more stools than the cash left after the rest of the basket can pay for.
    const spare = game.cash - facts.purchases + bought * SEAT_COST;
    const affordable = Math.max(0, Math.min(seatsLeft, Math.floor(spare / SEAT_COST)));
    seatStepper.setBounds(0, Math.max(affordable, bought));
    seatReason.textContent = affordable < seatsLeft && bought >= affordable ? 'Kasmu tidak cukup untuk bangku berikutnya.' : '';
  });

  // Training: one level at a time.
  const training = trainingText(game.trainingLevel);
  const levels = TRAINING.length - 1;
  const pips = h(
    'p',
    { class: 'pips', role: 'img', 'aria-label': `Pelatihan level ${game.trainingLevel} dari ${levels}` },
    Array.from({ length: levels }, (_, i) => h('span', { class: i < game.trainingLevel ? 'pips__pip pips__pip--done' : 'pips__pip' })),
  );
  const trainingCard = shelfItem({
    id: 'training',
    text: training ?? {
      icon: 'cap',
      name: `Pelatihan level ${game.trainingLevel}`,
      effect: 'Pegawaimu sudah menjalani semua pelatihan.',
    },
    cost: training?.cost ?? 0,
    owned: !training,
    ownedLabel: 'Level tertinggi',
    inBasket: () => draft.buy.training,
    toggle: () => {
      draft.buy.training = !draft.buy.training;
    },
    extra: pips,
    change: () => {
      if (!training) return [`Tiap pegawai melayani ${compact(draftFacts(game, draft).serviceRate)} pelanggan per jam.`];
      const without = draftFacts(game, imagine(draft, (copy) => (copy.buy.training = false)));
      const withIt = draftFacts(game, imagine(draft, (copy) => (copy.buy.training = true)));
      return [
        ...beforeAfter('training-rate', 'Kecepatan', compact(without.serviceRate), compact(withIt.serviceRate), 'pelanggan per jam'),
        h('br'),
        ...beforeAfter(
          'training-wage',
          'Gaji per jam',
          rupiah(wagePerHour(without.equipped)),
          rupiah(wagePerHour(withIt.equipped)),
        ),
      ];
    },
  });

  // One-time equipment.
  const withUpgrade = (id, on) =>
    draftFacts(
      game,
      imagine(draft, (copy) => {
        copy.buy.upgrades = copy.buy.upgrades.filter((other) => other !== id);
        if (on) copy.buy.upgrades.push(id);
      }),
    );
  const upgradeChange = {
    cashRegister: () =>
      game.upgrades.cashRegister
        ? [`Tiap pegawai melayani ${compact(draftFacts(game, draft).serviceRate)} pelanggan per jam.`]
        : beforeAfter(
            'register',
            'Kecepatan',
            compact(withUpgrade('cashRegister', false).serviceRate),
            compact(withUpgrade('cashRegister', true).serviceRate),
            'pelanggan per jam',
          ),
    queueNumbers: () =>
      game.upgrades.queueNumbers
        ? [`Pelanggan sabar menunggu rata-rata ${compact(draftFacts(game, draft).patienceMinutes)} menit.`]
        : beforeAfter(
            'numbers',
            'Sabar menunggu',
            compact(withUpgrade('queueNumbers', false).patienceMinutes),
            compact(withUpgrade('queueNumbers', true).patienceMinutes),
            'menit',
          ),
    shiftBoard: () =>
      game.upgrades.shiftBoard
        ? ['Jumlah pegawai bisa beda tiap shift.']
        : beforeAfter('board', 'Jadwal pegawai', 'sama seharian', 'bisa beda tiap shift'),
  };
  const upgradeCards = Object.entries(UPGRADE_TEXT).map(([id, text]) =>
    shelfItem({
      id,
      text,
      cost: UPGRADES[id].cost,
      owned: game.upgrades[id],
      inBasket: () => draft.buy.upgrades.includes(id),
      toggle: () => toggleUpgrade(draft, id),
      change: upgradeChange[id],
    }),
  );

  // Every card leans toward the pointer, as if picked up for a closer look.
  const wares = [seatCard, trainingCard, ...upgradeCards];
  wares.forEach((card) => tilt(card));

  // --- Keeping the shop in step with the basket -------------------------------

  const backLabel = h('span');
  /** Whether the basket and the stock together cost more than the cash, at the last look. */
  let overspent = false;
  function update() {
    const facts = draftFacts(game, draft);
    const count = basketCount(draft);

    wallet.cash.textContent = rupiah(game.cash);
    wallet.basket.replaceChildren(live('basket', count > 0 ? rupiah(-facts.purchases) : 'kosong'));
    stockLabel.replaceChildren(icon('bowl'), `Bahan ${integer(draft.stock)} porsi`);
    wallet.stock.textContent = rupiah(-facts.ingredients);
    wallet.left.replaceChildren(live('left', rupiah(facts.cashLeft)));
    wallet.left.classList.toggle('is-loss', facts.cashLeft < 0);
    walletNote.textContent =
      facts.cashLeft < 0
        ? `Kas tidak cukup untuk keranjang ini dan stok ${integer(draft.stock)} porsi. Keluarkan barang, atau kurangi stok di warung.`
        : 'Belum ada yang dibayar. Isi keranjang dibayar saat warung buka, dan langsung dipakai hari ini juga.';
    walletNote.classList.toggle('is-loss', facts.cashLeft < 0);

    // He speaks up the moment the basket no longer fits the cash.
    if (facts.cashLeft < 0 && !overspent) say(SHOP_WORDS.tooDear, 'shake');
    overspent = facts.cashLeft < 0;

    for (const redraw of shelf) redraw(facts);
    backLabel.textContent = count > 0 ? `Kembali ke warung, bawa ${count} barang` : 'Kembali ke warung';
    saveDraft(store, draft);
  }

  // --- Page -------------------------------------------------------------------

  words.textContent = game.history.length === 0 ? SHOP_WORDS.firstVisit : pick(SHOP_WORDS.welcome);

  const heading = h('h1', { id: 'view-title', tabindex: '-1', text: SHOP_NAME });
  container.append(
    h('section', { class: 'view view--toko', 'aria-labelledby': 'view-title' }, [
      h('header', { class: 'view__head' }, [
        heading,
        h('p', { class: 'toko__tagline', text: 'Serba ada buat warung. Harga pas, tidak bisa ditawar.' }),
        speech,
      ]),
      walletBar,
      walletNote,
      h('ul', { class: 'wares' }, wares),
      h('div', { class: 'toko__back' }, [
        h('a', { class: 'btn btn--primary', href: '#/pagi' }, [icon('chevron-left'), backLabel]),
      ]),
    ]),
  );

  update();

  // The first visit: what the numbers on a ware mean, and when it is paid for.
  let tour = null;
  const tourTimer =
    store.prefs.shopSeen || wares.length === 0
      ? null
      : window.setTimeout(() => {
          tour = startTour(
            [
              {
                target: wares[0],
                title: SHOP_NAME,
                text:
                  'Angka di tiap barang menunjukkan apa yang berubah di warungmu kalau barangnya diambil. ' +
                  'Isi keranjang baru dibayar saat warung buka, dan langsung dipakai hari itu juga.',
              },
            ],
            {
              onEnd: () => {
                tour = null;
                store.setPrefs({ shopSeen: true });
              },
            },
          );
        }, 900);

  return {
    heading,
    destroy() {
      window.clearTimeout(tourTimer);
      tour?.close();
    },
  };
}
