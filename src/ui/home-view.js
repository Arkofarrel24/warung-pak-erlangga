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
import { reputationRules } from './reputation-guide.js';
import { createScenePlayer } from './scene-player.js';
import { AUTHOR, EVENT_TEXT, GAME_NAME, SHOP_NAME } from './text.js';
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

/**
 * How to play, short enough to read before starting: the goal, the three
 * parts of a day, and the rules that change the game. Everything that is
 * only looked up (the marks in the scene, the events, the letters) is in a
 * list to open.
 */
function guide(startButton) {
  const act = (iconName, title, text) =>
    h('li', { class: 'how__step' }, [
      h('span', { class: 'how__icon' }, icon(iconName)),
      h('div', { class: 'how__words' }, [h('h3', { text: title }), h('p', { text })]),
    ]);
  const rule = (mark, text) => h('li', {}, [mark, h('span', { text })]);
  const more = (title, children) => h('details', { class: 'details details--block' }, [h('summary', { text: title }), children]);
  const eventGroup = (kind, iconName, title, lead) =>
    h('div', { class: 'happenings__group' }, [
      h('h3', {}, [icon(iconName), title]),
      h('p', { class: 'happenings__lead', text: lead }),
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
      ),
    ]);

  const heading = h('h2', { class: 'section-title section-title--center', id: 'guide-title', tabindex: '-1', text: 'Cara main' });
  const element = h('section', { class: 'guide', 'aria-labelledby': 'guide-title' }, [
    h('div', { class: 'guide__head' }, [
      heading,
      h('p', {
        class: 'goal__text',
        text: `Jaga warung ${DAY.count} hari tanpa kehabisan kas, lalu tutup buku dengan laba dan reputasi setinggi mungkin.`,
      }),
    ]),

    h('ol', { class: 'how__steps' }, [
      act('sun', 'Pagi: atur warung', `Pegawai, harga, stok, dan bangku tunggu. Mampir ke ${SHOP_NAME} kalau kasnya ada.`),
      act('shop', 'Siang: warung buka', 'Pelanggan datang, mengantre, dilayani. Yang kelamaan menunggu bisa batal antre.'),
      act('moon', 'Malam: baca laporan', 'Laba, reputasi, dan ukuran antrean yang sungguhan. Besok coba lebih baik.'),
    ]),

    h('ul', { class: 'goal__rules' }, [
      rule(
        h('span', { class: 'goal__stars', 'aria-hidden': 'true' }, [icon('star'), icon('star'), icon('star')]),
        `Bertahan ${DAY.count} hari dapat satu bintang. Kas akhir ${rupiah(STARS.two)} dapat dua, dan ${rupiah(STARS.three)} dapat tiga.`,
      ),
      rule(
        h('span', { class: 'goal__mark goal__mark--warning', 'aria-hidden': 'true' }, icon('up')),
        `Mulai hari ke-${RENT_RISE.fromDay} sewa naik ${rupiah(RENT_RISE.amount)} sehari. Warung yang jalan di tempat akan mulai rugi.`,
      ),
      rule(
        h('span', { class: 'goal__mark', 'aria-hidden': 'true' }, icon('users')),
        'Reputasi berjalan dari 0 sampai 100. Makin tinggi, makin banyak yang datang besok.',
      ),
    ]),

    h('div', { class: 'guide__more' }, [
      more(
        'Arti gambar di warung',
        h(
          'ul',
          { class: 'marks' },
          SCENE_MARKS.map(([name, title, text]) =>
            h('li', { class: 'mark' }, [figure(name), h('div', {}, [h('strong', { text: title }), h('p', { text })])]),
          ),
        ),
      ),
      more('Kejadian yang kadang datang', [
        h('p', {
          class: 'details__lead',
          text:
            `Mulai hari ke-${EVENTS.firstDay}, kira-kira ${compact(EVENTS.chance * 10)} dari 10 hari membawa satu kejadian. ` +
            'Hari pertama selalu tenang.',
        }),
        h('div', { class: 'happenings' }, [
          eventGroup(EVENT_KIND.NEWS, 'megaphone', 'Kabar pagi', 'Kamu diberi tahu sebelum mengatur warung, jadi masih bisa bersiap.'),
          eventGroup(EVENT_KIND.SURPRISE, 'zap', 'Kejutan', 'Baru ketahuan setelah warung buka, jadi tidak sempat bersiap.'),
        ]),
      ]),
      more('Reputasi: apa yang menaikkan dan menurunkannya', reputationRules()),
      more('Kamus huruf antrean (λ, μ, ρ, dan kawan-kawan)', [
        h('p', {
          class: 'details__lead',
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

/** Who made this, and where the code is: at the foot of the front page. */
function credit() {
  return h('footer', { class: 'credit' }, [
    h('p', {}, [
      `Dibuat oleh ${AUTHOR.name}. `,
      h('a', { href: AUTHOR.repo, rel: 'noopener', text: 'Kode dan cara kerjanya ada di GitHub' }),
      '.',
    ]),
  ]);
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
  const toGuide = h('button', { type: 'button', class: 'btn btn--quiet' }, [icon('book'), 'Cara main']);
  toGuide.addEventListener('click', () => {
    tutorial.element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    tutorial.heading.focus({ preventScroll: true });
  });

  // One way in, and the quieter choices under it.
  const quiet = (attributes, iconName, label) => h(attributes.href ? 'a' : 'button', { class: 'btn btn--quiet', ...attributes }, [icon(iconName), label]);
  let primary;
  const others = [toGuide];
  if (playing) {
    primary = resume();
    others.push(quiet({ type: 'button', onclick: () => startNewGame({ confirm: true }) }, 'refresh', 'Mulai ulang'));
  } else if (game) {
    primary = start('Main lagi');
    others.push(quiet({ href: '#/akhir' }, 'book', 'Lihat hasil terakhir'));
  } else {
    primary = start('Mulai kelola warung');
  }

  const canvas = h('canvas', { class: 'stage__canvas', 'aria-hidden': 'true' });
  const toggle = h('button', { type: 'button', class: 'stage__toggle' });
  const street = createStreetScene(canvas, toggle);

  const heading = h('h1', { id: 'view-title', class: 'sign__name', tabindex: '-1', text: GAME_NAME });
  container.append(
    h('section', { class: 'view view--home', 'aria-labelledby': 'view-title' }, [
      h('div', { class: 'home__hero' }, [
        // Painted the way warung signs are: the name, and under it what is served.
        h('div', { class: 'sign' }, [heading, h('p', { class: 'sign__menu', text: 'Sedia nasi, lauk, dan teori antrean' })]),
        h('div', { class: 'stage stage--home' }, [h('div', { class: 'stage__frame' }, [canvas, toggle])]),
        // The way in hangs on the bottom edge of the scene, as the sign hangs on its top.
        h('div', { class: 'home__start' }, primary),
        h('p', { class: 'home__tagline', text: `Kelola warung selama ${DAY.count} hari. Jangan sampai kas habis.` }),
        h('p', {
          class: 'stage__caption',
          text: 'Ini bukan video. Yang kamu lihat adalah mesin simulasi game ini sedang berjalan.',
        }),
        h('div', { class: 'home__actions' }, others),
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
                'Pagi pertama nanti saya temani, satu per satu.',
            }),
          ],
          { greet: 'wave' },
        ),
      ]),
      tutorial.element,
      credit(),
    ]),
  );
  street.start();

  return { heading, destroy: () => street.destroy() };
}
