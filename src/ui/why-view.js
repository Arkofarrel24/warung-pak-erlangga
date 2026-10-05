/**
 * "Kenapa begini?": the day explained in the terms of queueing theory.
 *
 * The findings come from explainDay() (src/game/explain.js), which computes
 * them from the day's report. This file only puts them into Indonesian, with
 * every number the finding rests on written out, so the reader can redo the
 * sum.
 */

import { explainDay } from '../game/explain.js';
import { h, icon } from './dom.js';
import { clock, compact, decimal, hourRange, integer, minutes, percent, rupiah } from './format.js';
import { bubble } from './pak-erlangga.js';
import { SHOP_NAME } from './text.js';

/** "12.00–13.00", or "12.00–13.00 dan 18.00–19.00", or the first two and how many more. */
function hourList(hours) {
  const ranges = hours.map(hourRange);
  if (ranges.length <= 2) return ranges.join(' dan ');
  return `${ranges.slice(0, 2).join(', ')}, dan ${ranges.length - 2} jam lainnya`;
}

/**
 * Each finding as words: the concept it belongs to, what happened (with its
 * numbers), and what could be tried. `short` is what Pak Erlangga says when
 * the finding is the costliest of the day.
 */
const WORDS = {
  overload: (f) => ({
    icon: 'users',
    concept: 'Intensitas trafik',
    symbol: 'λ ÷ c·μ',
    title: 'Jam ramai melebihi kapasitas',
    short: `yang datang di jam ramai lebih banyak daripada yang sanggup dilayani pegawaimu.`,
    text:
      `Pukul ${hourRange(f.worst.hour)} datang ${integer(f.worst.arrivals)} orang, padahal ${f.worst.staff} pegawai hanya sanggup ` +
      `melayani ${compact(f.worst.capacity)} orang per jam. Intensitas trafiknya ${integer(f.worst.arrivals)} ÷ ${compact(f.worst.capacity)} = ` +
      `${decimal(f.worst.intensity, 2)}. Selama angka ini di atas 1, antrean pasti menumpuk. ` +
      `Itu terjadi pada pukul ${hourList(f.hours)}, dan di jam-jam itu ${integer(f.lost)} pelanggan lepas.`,
    advice: 'Tambah pegawai di jam itu (papan shift membantu), atau percepat pelayanan lewat pelatihan dan mesin kasir.',
  }),
  reneging: (f) => ({
    icon: 'run',
    concept: 'Reneging (model Erlang-A)',
    symbol: 'θ',
    title: 'Yang menunggu terlalu lama akhirnya pulang',
    short: 'banyak yang sudah duduk menunggu lalu batal antre.',
    text:
      `${integer(f.reneged)} orang batal antre` +
      (f.waitedBeforeLeaving === null ? '. ' : ` setelah menunggu rata-rata ${minutes(f.waitedBeforeLeaving)}. `) +
      `Sabar pelangganmu rata-rata ${minutes(f.meanPatience, 0)}, dan seluruh pelanggan hari ini menunggu ${minutes(f.totalQueueTime, 0)} kalau dijumlah. ` +
      `Menurut model Erlang-A, yang batal antre rata-rata sebanyak waktu tunggu total ÷ sabar rata-rata: ` +
      `${decimal(f.totalQueueTime * 60, 0)} ÷ ${decimal(f.meanPatience * 60, 0)} = ${decimal(f.expected, 1)} orang. Hari ini ${integer(f.reneged)}.`,
    advice: `Pendekkan antreannya, atau beli nomor antrean di ${SHOP_NAME} supaya orang lebih sabar.`,
  }),
  blocking: (f) => ({
    icon: 'door',
    concept: 'Balking (antrean terbatas, M/M/c/K)',
    symbol: 'K',
    title: 'Bangku penuh, orang balik kanan',
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
          short: 'masakannya bersisa dan terbuang.',
          text:
            `${integer(f.portions)} porsi tidak terjual dan basi. Tiap porsi yang lebih berarti modal ${rupiah(f.each)} hilang: ` +
            `semuanya ${rupiah(f.cost)}.`,
          advice: 'Masak lebih sedikit besok, atau cari cara supaya lebih banyak yang terlayani.',
        },
  idle: (f) => ({
    icon: 'clock',
    concept: 'Utilisasi',
    symbol: 'ρ',
    title: 'Pegawai banyak menunggu',
    short: 'pegawaimu lebih banyak menunggu daripada melayani.',
    text:
      `Hanya ${percent(f.rho)} waktu pegawai terpakai melayani (ρ = ${decimal(f.rho, 2)}). Sisanya, senilai ${rupiah(f.cost)} gaji, ` +
      `habis untuk menunggu pelanggan. Paling sepi pukul ${hourList(f.quietHours)}.`,
    advice: 'Sedikit longgar itu perlu supaya antrean tidak panjang. Tapi kalau selonggar ini, kurangi pegawai di jam sepi (pakai papan shift).',
  }),
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
      `Bahan, gaji, dan sewa hari ini ${rupiah(f.costs)}. Supaya tertutup, harus terjual ${integer(Math.ceil(f.needed))} porsi. ` +
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

/** The whole explanation: one card per finding, the costliest first. */
export function whyPanel(report) {
  const findings = dayFindings(report);
  return h('section', { class: 'why', 'aria-labelledby': 'why-title' }, [
    h('h2', { class: 'sr-only', id: 'why-title', text: 'Kenapa hari ini begini' }),
    h('p', {
      class: 'why__lead',
      text:
        'Diurutkan dari yang paling mahal. Nilai tiap temuan dihitung sendiri-sendiri, dan pelanggan yang sama bisa ' +
        'terhitung di lebih dari satu temuan, jadi angkanya jangan dijumlahkan.',
    }),
    h(
      'ol',
      { class: 'why__list' },
      findings.map((finding) =>
        h('li', { class: 'card why__item' }, [
          h('span', { class: 'why__icon' }, icon(finding.icon)),
          h('div', { class: 'why__body' }, [
            h('p', { class: 'why__concept' }, [
              finding.symbol && h('span', { class: 'chip chip--param', text: finding.symbol }),
              finding.concept,
            ]),
            h('h3', { text: finding.title }),
            h('p', { text: finding.text }),
            h('p', { class: 'why__advice' }, [h('strong', { text: 'Yang bisa dicoba: ' }), finding.advice]),
          ]),
          finding.cost > 0 &&
            h('p', { class: 'why__cost' }, [h('small', { text: 'senilai' }), h('span', { class: 'num', text: rupiah(finding.cost) })]),
        ]),
      ),
    ),
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
      `Nilainya sekitar ${rupiah(main.cost)}.`
    : 'Hari ini tidak ada pelanggan yang lepas dan tidak ada masakan yang terbuang. Rapi sekali!';
  return bubble([h('p', { text: words }), more], { mood: profit ? 'happy' : 'sad' });
}
