/**
 * "Kenapa begini?": why the day went the way it did.
 *
 * The findings come from explainDay() (src/game/explain.js), which computes
 * them from the day's report. This file puts them into Indonesian, twice:
 *
 *   - short, for everyone: what happened in one sentence, what it cost, and
 *     one thing to try. Only the few costliest are shown; most players read
 *     no further, and should not have to.
 *   - in full, for whoever opens it: the concept from queueing theory each
 *     finding belongs to, with every number it rests on written out, so the
 *     sum can be redone by hand.
 */

import { LIMITS, SERVICE } from '../game/config.js';
import { explainDay } from '../game/explain.js';
import { h, icon } from './dom.js';
import { clock, compact, decimal, hourRange, integer, minutes, percent, rupiah, spokenRupiah } from './format.js';
import { bubble } from './pak-erlangga.js';
import { SHOP_NAME } from './text.js';

/**
 * Hours as stretches of the day: [0, 1, 2, 4] reads "08.00-11.00 dan 12.00-13.00".
 * Hours that follow one another are one stretch, so a saying about them names all of them.
 */
function hourList(hours) {
  const stretches = [];
  for (const hour of [...hours].sort((x, y) => x - y)) {
    const last = stretches.at(-1);
    if (last && last.to === hour) last.to = hour + 1;
    else stretches.push({ from: hour, to: hour + 1 });
  }
  const ranges = stretches.map(({ from, to }) => `${clock(from)}-${clock(to)}`);
  if (ranges.length <= 2) return ranges.join(' dan ');
  return `${ranges.slice(0, -1).join(', ')}, dan ${ranges.at(-1)}`;
}

/** How many findings are shown before the rest is folded away. */
const SHOWN = 3;

/**
 * Each finding as words.
 *
 *   title, what, tip  the short reading: a name, one sentence with the
 *                     number that matters, and one thing to try
 *   shop              the thing to try is sold next door
 *   concept, symbol,  the full reading: its name in queueing theory, the
 *   text, advice      working, and the advice with its caveats
 *   short             what Pak Erlangga says when it is the costliest of the day
 */
const WORDS = {
  overload: (f) => ({
    icon: 'users',
    concept: 'Intensitas trafik',
    symbol: 'λ ÷ c·μ',
    title: 'Jam ramai, pegawai kewalahan',
    what:
      `Pukul ${hourRange(f.worst.hour)} datang ${integer(f.worst.arrivals)} orang, pegawaimu hanya sanggup ${compact(f.worst.capacity)}. ` +
      `Di jam seperti itu ${integer(f.lost)} pelanggan lepas.`,
    // More pegawai is no advice to a warung that already has all it can hold.
    tip:
      f.worst.staff >= LIMITS.staff.max
        ? 'Pegawaimu sudah maksimal. Naikkan harga supaya yang datang di jam itu berkurang.'
        : `Tambah pegawai pukul ${hourList(f.hours)}.`,
    shop: false,
    short: `yang datang di jam ramai lebih banyak daripada yang sanggup dilayani pegawaimu.`,
    text:
      `Pukul ${hourRange(f.worst.hour)} datang ${integer(f.worst.arrivals)} orang, padahal ${f.worst.staff} pegawai hanya sanggup ` +
      `melayani ${compact(f.worst.capacity)} orang per jam. Intensitas trafiknya ${integer(f.worst.arrivals)} ÷ ${compact(f.worst.capacity)} = ` +
      `${decimal(f.worst.intensity, 2)}. Selama angka ini di atas 1, antrean pasti menumpuk. ` +
      `Itu terjadi pada pukul ${hourList(f.hours)}, dan di jam-jam itu ${integer(f.lost)} pelanggan lepas.`,
    advice: 'Tambah pegawai di jam itu (papan shift membantu), atau percepat pelayanan lewat pelatihan dan mesin kasir.',
  }),
  reneging: (f) => {
    // With queue numbers the customers are already more patient than they start out.
    const hasNumbers = f.patienceRate < SERVICE.basePatienceRate;
    return {
      icon: 'run',
      concept: 'Reneging (model Erlang-A)',
      symbol: 'θ',
      title: 'Kelamaan menunggu, lalu pulang',
      what:
        `${integer(f.reneged)} orang batal antre` +
        (f.waitedBeforeLeaving === null ? '.' : ` setelah menunggu rata-rata ${minutes(f.waitedBeforeLeaving)}.`),
      tip: hasNumbers
        ? 'Tambah pegawai di jam ramai supaya antreannya lebih pendek.'
        : 'Pendekkan antreannya, atau beli nomor antrean supaya orang lebih sabar.',
      shop: !hasNumbers,
      short: 'banyak yang sudah duduk menunggu lalu batal antre.',
      text:
        `${integer(f.reneged)} orang batal antre` +
        (f.waitedBeforeLeaving === null ? '. ' : ` setelah menunggu rata-rata ${minutes(f.waitedBeforeLeaving)}. `) +
        `Sabar pelangganmu rata-rata ${minutes(f.meanPatience, 0)}, dan seluruh pelanggan hari ini menunggu ${minutes(f.totalQueueTime, 0)} kalau dijumlah. ` +
        `Menurut model Erlang-A, yang batal antre rata-rata sebanyak waktu tunggu total ÷ sabar rata-rata: ` +
        `${decimal(f.totalQueueTime * 60, 0)} ÷ ${decimal(f.meanPatience * 60, 0)} = ${decimal(f.expected, 1)} orang. Hari ini ${integer(f.reneged)}.`,
      advice: `Pendekkan antreannya, atau beli nomor antrean di ${SHOP_NAME} supaya orang lebih sabar.`,
    };
  },
  blocking: (f) => ({
    icon: 'door',
    concept: 'Balking (antrean terbatas, M/M/c/K)',
    symbol: 'K',
    title: 'Bangku penuh, orang balik kanan',
    what: `${integer(f.rejected)} orang datang saat semua bangku terisi, lalu pergi.`,
    tip:
      f.seats >= LIMITS.seats.max
        ? 'Bangkumu sudah maksimal. Tambah pegawai, atau naikkan harga supaya yang datang berkurang.'
        : 'Tambah bangku, asal pegawaimu masih sanggup melayani.',
    shop: f.seats < LIMITS.seats.max,
    short: 'banyak yang datang saat semua bangku terisi, lalu balik kanan.',
    text:
      `${integer(f.rejected)} orang (${percent(f.share)} dari yang datang) tiba saat warung penuh. Warungmu muat K = ${f.places} orang: ` +
      `${f.servers} sedang dilayani dan ${f.seats} menunggu. Orang ke-${f.places + 1} tidak punya tempat.`,
    advice:
      'Bangku tambahan hanya menolong kalau pegawainya masih sanggup. Kalau tidak, yang tadinya balik kanan akan duduk, menunggu lama, lalu batal antre.',
  }),
  stock: (f) =>
    f.kind === 'short'
      ? {
          icon: 'empty',
          concept: 'Stok (masalah newsvendor)',
          title: 'Masakan habis sebelum tutup',
          what: `Stok habis pukul ${clock(f.soldOutAt)}. ${integer(f.portions)} orang tidak kebagian.`,
          tip: 'Masak lebih banyak besok.',
          short: 'masakannya habis sebelum warung tutup.',
          text:
            `Stok habis pukul ${clock(f.soldOutAt)}, dan ${integer(f.portions)} orang yang datang setelahnya tidak kebagian. ` +
            `Tiap porsi yang tidak ada berarti kehilangan untung ${rupiah(f.each)}: semuanya ${rupiah(f.cost)}.`,
          advice: 'Masak lebih banyak besok. Porsi yang kurang merugikan sebesar untungnya, porsi yang lebih merugikan sebesar modalnya.',
        }
      : {
          icon: 'bowl',
          concept: 'Stok (masalah newsvendor)',
          title: 'Masak kebanyakan',
          what: `${integer(f.portions)} porsi tidak terjual dan terbuang.`,
          tip: 'Masak lebih sedikit besok.',
          short: 'masakannya bersisa dan terbuang.',
          text:
            `${integer(f.portions)} porsi tidak terjual dan basi. Tiap porsi yang lebih berarti modal ${rupiah(f.each)} hilang: ` +
            `semuanya ${rupiah(f.cost)}.`,
          advice: 'Masak lebih sedikit besok, atau cari cara supaya lebih banyak yang terlayani.',
        },
  idle: (f) => {
    const when = f.allDay ? 'sepanjang hari' : `pukul ${hourList(f.hours)}`;
    // Without a schedule per shift, an hour cannot be staffed differently from the rest of the day.
    const needsBoard = !f.allDay && !f.scheduled;
    return {
      icon: 'clock',
      concept: 'Utilisasi',
      symbol: 'ρ',
      title: 'Ada jam yang kelebihan pegawai',
      what: `${f.allDay ? 'Sepanjang hari' : `Pukul ${hourList(f.hours)}`} satu pegawai lebih sedikit pun masih sanggup melayani semua yang datang.`,
      tip: `Kurangi satu pegawai ${when}.` + (needsBoard ? ' Papan shift bisa mengaturnya per shift.' : ''),
      shop: needsBoard,
      short: 'ada jam yang pegawainya lebih banyak daripada yang dibutuhkan.',
      text:
        `Di ${f.hours.length} jam (${hourList(f.hours)}), yang datang tidak melebihi kapasitas dengan satu pegawai lebih sedikit, ` +
        `jadi intensitas trafiknya tetap paling tinggi 1. Gaji satu pegawai selama jam-jam itu ${rupiah(f.cost)}. ` +
        `Utilisasi sepanjang hari ρ = ${decimal(f.rho, 2)}.`,
      advice: 'Sedikit longgar itu perlu supaya antrean tidak panjang, jadi yang dihitung hanya jam yang tetap cukup dengan satu pegawai lebih sedikit.',
    };
  },
  price: (f) =>
    f.kind === 'low'
      ? {
          icon: 'tag',
          concept: 'Harga dan antrean',
          symbol: 'λ',
          title: 'Harganya masih terlalu murah',
          what:
            `${integer(f.lost)} orang lepas karena antrean. Naik ${rupiah(f.step)} hanya membuat kira-kira ${integer(Math.round(f.keptAway))} orang tidak datang.`,
          tip: `Naikkan harga ${rupiah(f.step)}. Yang terlayani kira-kira tetap, untung per porsi naik.`,
          short: 'harganya masih terlalu murah untuk antrean sepanjang ini.',
          text:
            `Tiap naik ${rupiah(f.step)}, kira-kira ${percent(f.share)} pelanggan memilih tidak datang: hari ini ${integer(Math.round(f.keptAway))} orang. ` +
            `Yang lepas karena antrean (batal antre dan bangku penuh) ${integer(f.lost)} orang, lebih banyak dari itu. ` +
            `Jadi yang terlayani kira-kira tetap ${integer(f.served)}, masing-masing ${rupiah(f.step)} lebih mahal: ${rupiah(f.cost)}.`,
          advice: 'Ini taksiran dari angka satu hari, bukan simulasi ulang. Naikkan selangkah, lalu lihat laporan besok.',
        }
      : {
          icon: 'tag',
          concept: 'Harga dan antrean',
          symbol: 'λ',
          title: 'Harganya bisa diturunkan',
          what: `Tidak ada yang lepas dan pegawaimu masih longgar. Turun ${rupiah(f.step)} kira-kira membawa ${integer(Math.round(f.more))} pelanggan lagi.`,
          tip: `Turunkan harga ${rupiah(f.step)}, dan masak lebih banyak.`,
          short: 'warungnya masih sanggup melayani lebih banyak orang dengan harga lebih murah.',
          text:
            `Tiap turun ${rupiah(f.step)}, kira-kira ${percent(f.share)} lebih banyak yang datang: hari ini ${integer(Math.round(f.more))} orang, ` +
            `dan di tiap jam kapasitasmu masih cukup untuk mereka. Untung per porsi jadi ${rupiah(f.margin)}: ` +
            `tambahan dari pelanggan baru dikurangi potongan untuk ${integer(f.served)} yang sudah datang = ${rupiah(f.cost)}.`,
          advice: 'Ini taksiran dari angka satu hari, bukan simulasi ulang. Turunkan selangkah, lalu lihat laporan besok.',
        },
  little: (f) => ({
    icon: 'info',
    concept: 'Hukum Little',
    symbol: 'Lq = λ × Wq',
    title: 'Panjang antrean hari ini, dihitung dua cara',
    text:
      `Rata-rata ada ${decimal(f.Lq, 2)} orang yang mengantre. Angka yang sama keluar dari hukum Little: ` +
      `${decimal(f.rate, 1)} orang masuk per jam × ${minutes(f.wait)} menunggu = ${decimal(f.rate * f.wait, 2)} orang.`,
    advice: 'Jadi antrean hanya bisa dipendekkan lewat dua jalan: lebih sedikit yang masuk, atau waktu tunggu yang lebih singkat.',
  }),
  breakEven: (f) => ({
    icon: 'tag',
    concept: 'Titik impas',
    title: 'Berapa porsi supaya balik modal',
    text:
      `Bahan, gaji, dan sewa hari ini ${rupiah(f.costs)}. ` +
      (f.tips > 0
        ? `Tip ${rupiah(f.tips)} sudah menutup sebagian. Supaya sisanya tertutup, harus terjual ${integer(Math.ceil(f.needed))} porsi. `
        : `Supaya tertutup, harus terjual ${integer(Math.ceil(f.needed))} porsi. `) +
      `Terjual ${integer(f.sold)}: ` +
      (f.sold >= Math.ceil(f.needed)
        ? `lebih ${integer(f.sold - Math.ceil(f.needed))} porsi dari titik impas.`
        : `kurang ${integer(Math.ceil(f.needed) - f.sold)} porsi dari titik impas.`),
    advice: 'Titik impas turun kalau biaya turun atau harga naik, tetapi harga yang naik juga mengurangi yang datang.',
  }),
};

/** Every finding of a day, in words. */
export function dayFindings(report) {
  return explainDay(report).map((finding) => ({ ...finding, ...WORDS[finding.id](finding) }));
}

/** A finding in short: what happened, what it cost, one thing to try. */
function entry(finding) {
  return h('li', { class: 'why__item' }, [
    h('span', { class: 'why__icon' }, icon(finding.icon)),
    h('div', { class: 'why__body' }, [
      h('h3', { text: finding.title }),
      h('p', { text: finding.what }),
      h('p', { class: 'why__tip' }, [h('strong', { text: 'Coba: ' }), finding.tip]),
    ]),
    h('p', { class: 'why__cost' }, [h('small', { text: 'senilai' }), h('span', { class: 'num', text: rupiah(finding.cost) })]),
  ]);
}

/** A finding in full: its name in queueing theory and the working behind it. */
function proof(finding) {
  return h('li', { class: 'why__proof' }, [
    h('h3', { text: finding.title }),
    h('p', { class: 'why__concept' }, [
      finding.symbol && h('span', { class: 'chip chip--param', text: finding.symbol }),
      finding.concept,
    ]),
    h('p', { text: finding.text }),
    h('p', { class: 'why__advice' }, [h('strong', { text: 'Yang bisa dicoba: ' }), finding.advice]),
  ]);
}

/**
 * The explanation of a day. What cost money comes first, the costliest at
 * the top and only the first few in sight; the working is there to open.
 *
 * @param {object} report
 * @param {object} [options]
 * @param {boolean} [options.canShop] there is a morning ahead, so what is sold next door can still be bought
 */
export function whyPanel(report, { canShop = false } = {}) {
  const findings = dayFindings(report);
  const costly = findings.filter((finding) => finding.cost > 0);
  const shown = costly.slice(0, SHOWN);
  const rest = costly.slice(SHOWN);

  return h('section', { class: 'why', 'aria-labelledby': 'why-title' }, [
    h('header', { class: 'why__head' }, [
      h('h2', { id: 'why-title', text: costly.length > 0 ? 'Yang paling mahal hari ini' : 'Hari ini rapi' }),
      costly.length > 1 &&
        h('p', { class: 'why__lead', text: 'Urut dari yang terbesar. Angkanya bisa tumpang-tindih, jadi jangan dijumlahkan.' }),
      costly.length === 0 &&
        h('p', {
          class: 'why__lead',
          text: 'Tidak ada pelanggan yang lepas, tidak ada masakan yang terbuang, dan pegawaimu tidak banyak menganggur.',
        }),
    ]),
    shown.length > 0 && h('ol', { class: 'why__list' }, shown.map(entry)),
    rest.length > 0 &&
      h('details', { class: 'details why__more' }, [
        h('summary', { text: `${rest.length} hal lain yang lebih kecil` }),
        h('ol', { class: 'why__list' }, rest.map(entry)),
      ]),
    // What is suggested above is sold next door: the way there, once.
    canShop &&
      shown.some((finding) => finding.shop) &&
      h('a', { class: 'btn why__shop', href: '#/toko' }, [icon('basket'), `Mampir ke ${SHOP_NAME}`]),
    h('details', { class: 'details details--block why__working' }, [
      h('summary', { text: 'Hitungan lengkapnya, dengan rumus teori antrean' }),
      h('p', { class: 'details__lead', text: 'Semua angka di bawah diambil dari laporan hari ini, jadi bisa dihitung ulang dengan tangan.' }),
      h('ol', { class: 'why__proofs' }, findings.map(proof)),
    ]),
  ]);
}

/**
 * Pak Erlangga's one-sentence reading of the day, for the summary: the
 * costliest finding, and the way to the rest.
 */
export function whyTeaser(report, onMore) {
  const main = dayFindings(report).find((finding) => finding.cost > 0 && finding.short);
  const more = h('button', { type: 'button', class: 'bubble__action', onclick: onMore }, [
    icon('info'),
    h('span', { text: 'Kenapa begini?' }),
  ]);
  const profit = report.ledger.profit >= 0;
  const words = main
    ? `${profit ? 'Hari ini untung, tapi masih ada yang bocor' : 'Hari ini rugi, dan ini penyebab terbesarnya'}: ${main.short} ` +
      `Nilainya ${spokenRupiah(main.cost)}.`
    : 'Hari ini tidak ada pelanggan yang lepas dan tidak ada masakan yang terbuang. Rapi sekali!';
  return bubble([h('p', { text: words }), more], { mood: profit ? 'happy' : 'sad' });
}
