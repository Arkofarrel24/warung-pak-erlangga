/** The front of the warung: start a game, or go on with the saved one. */

import { DAY, EVENTS, RENT_RISE, SERVICE, STARS, START } from '../game/config.js';
import { EVENT_KIND } from '../game/events.js';
import { STATUS } from '../game/game.js';
import { QueueSimulation } from '../sim/engine.js';
import { h, icon } from './dom.js';
import { figure } from './figures.js';
import { compact, rupiah } from './format.js';
import { prefersReducedMotion } from './motion.js';
import { bubble } from './pak-erlangga.js';
import { phaseAt, setPhase } from './phase.js';
import { createScenePlayer } from './scene-player.js';
import { EVENT_TEXT, GAME_NAME, SHOP_NAME } from './text.js';
import { WarungScene } from './warung-scene.js';

/** The street scene runs through a day and a short night, then starts over. */
const SCENE_DAY_HOURS = 14.5;
const SCENE_HOURS_PER_SECOND = 1 / 7;
const SCENE_SEATS = 3;

/**
 * The street in front of the warung, alive on the front page.
 *
 * It is not a recording. It is the game's own simulation engine running a
 * warung like the one the player is about to take over, without end:
 * customers arrive at random, wait on the stools while their patience runs
 * down, and are served or give up.
 */
function createStreetScene(canvas, toggle) {
  const simulation = new QueueSimulation({
    arrivalRate: 23,
    serviceRate: SERVICE.baseRate,
    servers: START.staff,
    waitingRoom: SCENE_SEATS,
    patienceRate: SERVICE.basePatienceRate,
    duration: 1e9,
    seed: 20_261_006,
  });
  // A head start, so the street is not empty when the page opens.
  while (simulation.fel.peek().time < 2) simulation.step();

  const scene = new WarungScene(canvas, {
    seats: SCENE_SEATS,
    maxServers: START.staff,
    priceLabel: `+${compact(START.price / 1000)} rb`,
  });
  const player = createScenePlayer({
    simulation,
    scene,
    hoursPerSecond: SCENE_HOURS_PER_SECOND,
    dayHour: (clock) => clock % SCENE_DAY_HOURS,
    // The header takes the light of the street's own day.
    onFrame: (clock) => setPhase(phaseAt(clock % SCENE_DAY_HOURS)),
  });

  function renderToggle() {
    toggle.replaceChildren(icon(player.playing ? 'pause' : 'play'), h('span', { text: player.playing ? 'Jeda' : 'Putar' }));
  }
  toggle.addEventListener('click', () => {
    if (player.playing) player.pause();
    else player.play();
    renderToggle();
  });
  const observer = new ResizeObserver(() => {
    scene.resize();
    player.redraw();
  });

  return {
    start() {
      observer.observe(canvas);
      scene.resize();
      player.start();
      // Moving content does not start on its own for those who asked for less motion.
      if (!prefersReducedMotion()) player.play();
      renderToggle();
    },
    destroy() {
      observer.disconnect();
      player.stop();
    },
  };
}

/** What each mark in the street scene means. The pictures are the scene's own figures. */
const SCENE_MARKS = [
  ['patience', 'Batang kesabaran', 'Ada di atas kepala yang sedang menunggu. Makin pendek dan merah, makin dekat dia menyerah lalu pulang.'],
  ['service', 'Cincin kuning', 'Sedang dilayani. Begitu cincinnya menutup penuh, pesanannya selesai.'],
  ['served', 'Kantong dan “+10 rb”', 'Pulang membawa bungkusan: satu porsi terjual, uangnya masuk kas.'],
  ['reneged', 'Tanda seru', 'Batal antre. Sudah duduk menunggu, tetapi sabarnya habis lebih dulu.'],
  ['balked', 'Tanda silang', 'Balik kanan. Semua bangku terisi, jadi dia tidak ikut mengantre.'],
  ['soldOut', 'Piring dicoret', 'Kehabisan. Stok masakan hari itu sudah habis.'],
  ['stools', 'Bangku plastik', 'Tempat menunggu. Banyaknya bangku adalah panjang antrean paling banyak.'],
];

/** The three figures chalked on the board at the top of every screen. */
const BOARD_FIGURES = [
  ['sun', 'Hari', `Hari ke berapa dari ${DAY.count}.`],
  ['wallet', 'Kas', 'Uang warung. Kalau habis, permainan selesai.'],
  ['star', 'Reputasi', 'Dari 0 sampai 100. Makin tinggi, makin banyak yang datang besok.'],
];

/** The letters of queueing theory, as they appear on the morning screen and in the report. */
const GLOSSARY = [
  ['λ', 'Laju kedatangan', 'berapa pelanggan datang per jam. Naik turun mengikuti jam, harga, dan reputasi.'],
  ['μ', 'Laju pelayanan', 'berapa pelanggan yang sanggup dilayani satu pegawai per jam.'],
  ['c', 'Jumlah pelayan', 'pegawai yang sedang melayani.'],
  ['K', 'Kapasitas', 'paling banyak orang di warung: yang dilayani ditambah yang duduk menunggu.'],
  ['1/θ', 'Kesabaran', 'rata-rata lama pelanggan mau menunggu sebelum batal antre.'],
  ['ρ', 'Utilisasi', 'bagian waktu pegawai yang terpakai melayani. Mendekati 1 berarti kewalahan.'],
  ['Wq', 'Waktu tunggu', 'rata-rata lama pelanggan mengantre sebelum dilayani.'],
  ['Lq', 'Panjang antrean', 'rata-rata banyaknya orang yang sedang menunggu.'],
];

function guide(startButton) {
  const block = (number, title, children) =>
    h('section', { class: 'guide__block', 'aria-labelledby': `guide-${number}` }, [
      h('h3', { class: 'guide__title', id: `guide-${number}` }, [
        h('span', { class: 'guide__number', 'aria-hidden': 'true', text: String(number) }),
        title,
      ]),
      children,
    ]);
  const step = (iconName, title, text) =>
    h('li', { class: 'card how__step' }, [
      h('span', { class: 'how__icon' }, icon(iconName)),
      h('h4', { text: title }),
      h('p', { text }),
    ]);
  const eventList = (kind) =>
    h(
      'ul',
      { class: 'happenings__list' },
      Object.entries(EVENTS.catalog)
        .filter(([, spec]) => spec.kind === kind)
        .map(([id]) =>
          h('li', { class: 'happening' }, [
            h('span', { class: 'happening__icon' }, icon(EVENT_TEXT[id].icon)),
            h('div', {}, [h('strong', { text: EVENT_TEXT[id].name }), h('p', { text: EVENT_TEXT[id].tutorial })]),
          ]),
        ),
    );

  const heading = h('h2', { class: 'section-title section-title--center', id: 'guide-title', tabindex: '-1', text: 'Cara main' });
  const element = h('section', { class: 'guide', 'aria-labelledby': 'guide-title' }, [
    heading,
    h('p', { class: 'guide__lead', text: `Dua menit membaca, ${DAY.count} hari menjaga warung.` }),

    block(1, 'Tujuanmu', [
      h('div', { class: 'card goal' }, [
        h('span', { class: 'goal__icon' }, icon('target')),
        h('p', {
          class: 'goal__text',
          text: `Jaga warung ${DAY.count} hari tanpa kehabisan kas, lalu tutup buku dengan laba dan reputasi setinggi mungkin.`,
        }),
        h(
          'dl',
          { class: 'goal__figures' },
          BOARD_FIGURES.map(([iconName, name, text]) =>
            h('div', { class: 'goal__figure' }, [h('dt', {}, [icon(iconName), name]), h('dd', { text })]),
          ),
        ),
        h('ul', { class: 'goal__rules' }, [
          h('li', {}, [
            h('span', { class: 'goal__stars', 'aria-hidden': 'true' }, [icon('star'), icon('star'), icon('star')]),
            h('span', {
              text:
                `Bertahan ${DAY.count} hari dapat satu bintang. Kas akhir ${rupiah(STARS.two)} dapat dua, ` +
                `dan ${rupiah(STARS.three)} dapat tiga.`,
            }),
          ]),
          h('li', {}, [
            h('span', { class: 'goal__warning', 'aria-hidden': 'true' }, icon('up')),
            h('span', {
              text:
                `Mulai hari ke-${RENT_RISE.fromDay} sewa naik ${rupiah(RENT_RISE.amount)} sehari. ` +
                'Warung yang jalan di tempat akan mulai rugi.',
            }),
          ]),
        ]),
      ]),
    ]),

    block(2, 'Satu hari, tiga babak', [
      h('ol', { class: 'how__steps' }, [
        step('sun', 'Pagi: atur warung', `Pegawai, harga, stok, dan bangku tunggu. Mampir ke ${SHOP_NAME} kalau kasnya ada.`),
        step('shop', 'Siang: warung buka', 'Pelanggan datang, mengantre, dilayani. Yang kelamaan menunggu bisa batal antre.'),
        step('moon', 'Malam: baca laporan', 'Laba, reputasi, dan ukuran antrean yang sungguhan. Besok coba lebih baik.'),
      ]),
    ]),

    block(3, 'Arti gambar di warung', [
      h(
        'ul',
        { class: 'marks' },
        SCENE_MARKS.map(([name, title, text]) =>
          h('li', { class: 'card mark' }, [figure(name), h('div', {}, [h('strong', { text: title }), h('p', { text })])]),
        ),
      ),
    ]),

    block(4, 'Kadang ada kejadian', [
      h('p', {
        class: 'guide__text',
        text:
          `Mulai hari ke-${EVENTS.firstDay}, kira-kira ${compact(EVENTS.chance * 10)} dari 10 hari membawa satu kejadian. ` +
          'Hari pertama selalu tenang.',
      }),
      h('div', { class: 'happenings' }, [
        h('div', { class: 'card happenings__group' }, [
          h('h4', {}, [icon('megaphone'), 'Kabar pagi']),
          h('p', { class: 'happenings__lead', text: 'Kamu diberi tahu sebelum mengatur warung, jadi masih bisa bersiap.' }),
          eventList(EVENT_KIND.NEWS),
        ]),
        h('div', { class: 'card happenings__group happenings__group--surprise' }, [
          h('h4', {}, [icon('zap'), 'Kejutan']),
          h('p', { class: 'happenings__lead', text: 'Baru ketahuan setelah warung buka, jadi tidak sempat bersiap.' }),
          eventList(EVENT_KIND.SURPRISE),
        ]),
      ]),
    ]),

    h('details', { class: 'details guide__glossary' }, [
      h('summary', { text: 'Kamus huruf antrean (λ, μ, ρ, dan kawan-kawan)' }),
      h('p', {
        class: 'guide__text',
        text: 'Tidak perlu dihafal. Huruf-huruf ini muncul di layar pagi dan di laporan malam, selalu dengan penjelasannya.',
      }),
      h(
        'dl',
        { class: 'glossary' },
        GLOSSARY.map(([symbol, name, text]) =>
          h('div', { class: 'glossary__item' }, [
            h('dt', {}, [h('span', { class: 'chip chip--param', text: symbol }), name]),
            h('dd', { text }),
          ]),
        ),
      ),
    ]),

    h('p', {
      class: 'how__note',
      text:
        'Antreannya bukan angka karangan. Tiap pelanggan disimulasikan satu per satu dengan discrete-event simulation, ' +
        'dan mesinnya sudah dicocokkan dengan rumus teori antrean.',
    }),
    startButton && h('div', { class: 'home__actions' }, startButton),
  ]);
  return { element, heading };
}

export function renderHome(container, { store, startNewGame }) {
  const { game } = store;
  const playing = game?.status === STATUS.PLAYING;

  const start = (label) =>
    h('button', { type: 'button', class: 'btn btn--primary', onclick: () => startNewGame({ confirm: false }) }, [
      icon('play'),
      label,
    ]);
  const resume = () => h('a', { class: 'btn btn--primary', href: '#/pagi' }, [icon('play'), `Lanjutkan hari ke-${game.day}`]);
  // The tutorial ends with the same way in as the top of the page.
  const tutorial = guide(playing ? resume() : start(game ? 'Main lagi' : 'Mulai kelola warung'));
  const toGuide = h('button', { type: 'button', class: 'btn' }, [icon('book'), 'Cara main']);
  toGuide.addEventListener('click', () => {
    tutorial.element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    tutorial.heading.focus({ preventScroll: true });
  });

  let actions;
  if (playing) {
    actions = [
      resume(),
      toGuide,
      h('button', { type: 'button', class: 'btn', onclick: () => startNewGame({ confirm: true }) }, [
        icon('refresh'),
        'Mulai dari awal',
      ]),
    ];
  } else if (game) {
    actions = [start('Main lagi'), toGuide, h('a', { class: 'btn', href: '#/akhir' }, [icon('book'), 'Lihat hasil terakhir'])];
  } else {
    actions = [start('Mulai kelola warung'), toGuide];
  }

  const canvas = h('canvas', { class: 'stage__canvas', 'aria-hidden': 'true' });
  const toggle = h('button', { type: 'button', class: 'stage__toggle' });
  const street = createStreetScene(canvas, toggle);

  const heading = h('h1', { id: 'view-title', class: 'sign__name', tabindex: '-1', text: GAME_NAME });
  container.append(
    h('section', { class: 'view view--home', 'aria-labelledby': 'view-title' }, [
      h('div', { class: 'home__hero' }, [
        h('div', { class: 'sign' }, [
          h('p', { class: 'sign__eyebrow', text: 'Sedia nasi, lauk, dan teori antrean' }),
          heading,
        ]),
        h('figure', { class: 'stage stage--home' }, [
          h('div', { class: 'stage__frame' }, [canvas, toggle]),
          h('figcaption', {
            class: 'stage__caption',
            text: 'Ini bukan video. Yang kamu lihat adalah mesin simulasi game ini sedang berjalan.',
          }),
        ]),
        h('p', { class: 'home__tagline', text: `Kelola warung selama ${DAY.count} hari. Jangan sampai kas habis.` }),
        h('div', { class: 'home__actions' }, actions),
        store.saveFailed &&
          h('p', { class: 'notice' }, [
            icon('info'),
            'Browser ini tidak mengizinkan penyimpanan, jadi permainan tidak akan tersimpan saat halaman ditutup.',
          ]),
        bubble(
          [
            h('p', {
              text:
                'Saya Erlangga. Tiga puluh tahun saya jaga warung ini, sekarang giliranmu. ' +
                `Modalnya ${rupiah(START.cash)}. Tiap pagi kamu yang mengatur: berapa pegawainya, berapa harganya, berapa porsinya.`,
            }),
            h('p', {
              text:
                'Tiap malam kita baca laporannya sama-sama. Antrean itu ada ilmunya, dan warung ini tempat belajarnya. ' +
                'Baca dulu cara mainnya di bawah, ya.',
            }),
          ],
          { greet: 'wave' },
        ),
      ]),
      tutorial.element,
    ]),
  );
  street.start();

  return { heading, destroy: () => street.destroy() };
}
