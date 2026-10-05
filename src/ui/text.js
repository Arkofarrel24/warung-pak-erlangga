/**
 * The words of the interface that are tied to the rules of the game: what a
 * purchase is called, what each rule violation means in a sentence.
 *
 * The game logic speaks in codes and numbers; this file turns them into
 * Indonesian.
 */

import { COSTS, EVENTS, LIMITS, SHIFTS, TRAINING, UPGRADES } from '../game/config.js';
import { ingredientCost } from '../game/events.js';
import { PROBLEM } from '../game/game.js';
import { clock, compact, percent, rupiah } from './format.js';

export const GAME_NAME = 'Warung Pak Erlangga';

/** The four shifts, by id. */
export const SHIFT_NAME = Object.freeze({
  pagi: 'Pagi',
  siang: 'Siang',
  sore: 'Sore',
  petang: 'Petang',
});

export function shiftLabel(shift) {
  return `${SHIFT_NAME[shift.id]} ${clock(shift.from)}–${clock(shift.to)}`;
}

export const SHIFT_LABELS = SHIFTS.map(shiftLabel);

/** What the shop next door is called. */
export const SHOP_NAME = 'Toko Sebelah';

/**
 * One-time purchases, in plain words. `symbol` names the queueing parameter
 * a purchase changes; it is shown only where the queue is described in the
 * notation of queueing theory, not on the shop's shelves. `quips` is what
 * Pak Erlangga may say when the thing goes into the basket: one of them is
 * picked each time, so he does not repeat himself.
 */
export const UPGRADE_TEXT = Object.freeze({
  cashRegister: {
    icon: 'register',
    name: 'Mesin kasir',
    symbol: 'μ',
    effect: `Bayarnya jadi cepat. Tiap pegawai bisa melayani ${percent(UPGRADES.cashRegister.serviceFactor - 1)} lebih banyak pelanggan per jam.`,
    quips: [
      'Nah, ini baru. Dulu saya hitung kembalian pakai jari, sering salah pula.',
      'Mesin kasir, ya? Bagus. Bayarnya cepat, antreannya ikut cepat.',
    ],
  },
  queueNumbers: {
    icon: 'ticket',
    name: 'Nomor antrean',
    symbol: 'θ',
    effect: 'Pelanggan ambil nomor lalu duduk santai, jadi mereka lebih betah menunggu giliran.',
    quips: [
      'Orang kalau sudah pegang nomor, hatinya lebih tenang. Nunggunya jadi lebih betah.',
      'Boleh juga. Daripada berdiri sambil cemberut, mending duduk pegang nomor.',
    ],
  },
  shiftBoard: {
    icon: 'calendar',
    name: 'Papan shift',
    symbol: 'c(t)',
    effect: 'Jumlah pegawai bisa diatur per shift: sedikit saat sepi, banyak saat ramai.',
    quips: [
      'Ini yang saya suka. Buat apa tiga orang jaga jam 3 sore kalau yang lewat cuma kucing?',
      'Pintar. Ramai, tambah orang. Sepi, ya dikurangi. Gajinya jadi tidak terbuang.',
    ],
  },
});

export function trainingText(level) {
  const next = TRAINING[level + 1];
  if (!next) return null;
  const faster = next.serviceFactor / TRAINING[level].serviceFactor - 1;
  const dearer = next.wageFactor / TRAINING[level].wageFactor - 1;
  return {
    icon: 'cap',
    name: `Pelatihan level ${level + 1}`,
    symbol: 'μ',
    effect: `Semua pegawai jadi ${percent(faster)} lebih cepat, tapi gaji per jamnya naik ${percent(dearer)}.`,
    quips: [
      'Pegawai diajari itu tidak ada ruginya. Tangannya makin cekatan, pelanggan pun senang.',
      'Bagus. Tapi ingat ya, makin pintar pegawainya, gajinya juga minta naik.',
    ],
    cost: next.cost,
  };
}

export const SEAT_TEXT = Object.freeze({
  icon: 'chair',
  name: 'Bangku plastik',
  symbol: 'K',
  effect: 'Satu bangku tunggu lagi, jadi lebih banyak orang bisa menunggu giliran saat warung ramai.',
  quips: [
    'Tambah bangku? Boleh. Tapi bangku banyak itu belum tentu antreannya cepat, lho.',
    'Merah, biru, hijau... ambil saja yang mana, harganya sama kok.',
  ],
});

/** What Pak Erlangga says at the shop when nothing in particular has happened. */
export const SHOP_WORDS = Object.freeze({
  firstVisit: 'Ini toko langganan saya dari dulu. Lihat-lihat saja dulu, hari pertama tidak beli juga tidak apa-apa.',
  welcome: [
    'Mau nambah apa hari ini? Pelan-pelan saja, hitung dulu kasnya.',
    'Coba lihat angka di tiap barang. Itu yang berubah di warungmu kalau barangnya kamu ambil.',
    'Jangan asal borong, ya. Beli yang paling kamu butuhkan dulu.',
  ],
  putBack: [
    'Tidak jadi? Ya sudah, tidak apa-apa. Barangnya tidak ke mana-mana.',
    'Oke, saya taruh lagi di rak. Besok-besok juga masih ada.',
  ],
  seatBack: 'Bangkunya saya kembalikan ke tumpukan, ya.',
  tooDear: 'Waduh, kasnya tidak cukup kalau begini. Kurangi dulu barangnya, atau stok masakannya.',
});

/** One of a few lines, so the same thing is not said twice in a row. */
export function pick(lines, avoid) {
  const choices = lines.length > 1 ? lines.filter((line) => line !== avoid) : lines;
  return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * The unexpected, in words. `morning` is what Pak Erlangga says about a
 * piece of news before the day; `struck` is what is said about a surprise at
 * the moment it happens; `happened` is the same event looked back on. Both
 * are read right after the event's name. `tutorial` is the one line on the
 * front page.
 */
const share = (factor) => percent(Math.abs(factor - 1));
const catalog = EVENTS.catalog;

export const EVENT_TEXT = Object.freeze({
  ingredientsUp: {
    icon: 'up',
    name: 'Harga bahan naik',
    tutorial: `Modal per porsi naik ${share(catalog.ingredientsUp.costFactor)}. Margin menipis.`,
    morning: (event) =>
      `Kabar dari pasar: harga bahan naik. Hari ini satu porsi modalnya ${rupiah(ingredientCost(event))}, bukan ${rupiah(COSTS.ingredient)}. Pikirkan lagi harga jual dan stokmu.`,
    happened: (event) => `Modal per porsi hari ini ${rupiah(ingredientCost(event))}, bukan ${rupiah(COSTS.ingredient)}.`,
  },
  ingredientsDown: {
    icon: 'down',
    name: 'Bahan lagi murah',
    tutorial: `Modal per porsi turun ${share(catalog.ingredientsDown.costFactor)}. Saatnya untung lebih.`,
    morning: (event) =>
      `Rezeki pagi: bahan lagi murah di pasar. Hari ini satu porsi modalnya cuma ${rupiah(ingredientCost(event))}.`,
    happened: (event) => `Modal per porsi hari ini cuma ${rupiah(ingredientCost(event))}, bukan ${rupiah(COSTS.ingredient)}.`,
  },
  rain: {
    icon: 'rain',
    name: 'Hujan seharian',
    tutorial: `Yang datang kira-kira ${share(catalog.rain.demandFactor)} lebih sedikit. Jangan kebanyakan stok.`,
    morning: () =>
      `Langitnya gelap dari subuh. Kalau hujan seharian, yang datang kira-kira ${share(catalog.rain.demandFactor)} lebih sedikit. Hati-hati dengan stok.`,
    happened: () => `Yang datang kira-kira ${share(catalog.rain.demandFactor)} lebih sedikit dari biasanya.`,
  },
  payday: {
    icon: 'cash',
    name: 'Tanggal gajian',
    tutorial: `Yang datang kira-kira ${share(catalog.payday.demandFactor)} lebih banyak. Siapkan stok dan pegawai.`,
    morning: () =>
      `Hari ini orang-orang baru gajian. Biasanya yang datang ${share(catalog.payday.demandFactor)} lebih banyak. Stok dan pegawainya cukup?`,
    happened: () => `Yang datang kira-kira ${share(catalog.payday.demandFactor)} lebih banyak dari biasanya.`,
  },
  nightMarket: {
    icon: 'tent',
    name: 'Pasar malam',
    tutorial: `Mulai pukul ${clock(catalog.nightMarket.from)} jauh lebih ramai dari biasanya.`,
    morning: () =>
      `Nanti sore ada pasar malam di lapangan sebelah. Mulai pukul ${clock(catalog.nightMarket.from)} yang datang bisa ${compact(catalog.nightMarket.demandFactor)} kali lipat biasanya.`,
    happened: () =>
      `Mulai pukul ${clock(catalog.nightMarket.from)}, yang datang ${compact(catalog.nightMarket.demandFactor)} kali lipat biasanya.`,
  },
  staffSick: {
    icon: 'sick',
    name: 'Pegawai sakit',
    tutorial: 'Satu pegawai mendadak tidak masuk. Kalau pegawaimu pas-pasan, antrean langsung menumpuk.',
    struck: () => 'Ia mendadak tidak masuk, jadi hari ini warung kurang satu orang.',
    happened: () => 'Ia mendadak tidak masuk, jadi hari ini warung kurang satu orang (dan gajinya tidak dibayar).',
  },
  tourGroup: {
    icon: 'bus',
    name: 'Rombongan datang',
    tutorial: `Satu bus berhenti: ${catalog.tourGroup.size} orang masuk sekaligus.`,
    struck: () => `Satu bus berhenti di depan warung dan ${catalog.tourGroup.size} orang masuk sekaligus!`,
    happened: (event) => `Satu bus berhenti pukul ${clock(event.time)} dan ${catalog.tourGroup.size} orang masuk sekaligus.`,
  },
  gasOut: {
    icon: 'flame',
    name: 'Gas habis',
    tutorial: `Selama ${compact(catalog.gasOut.duration)} jam, satu pegawai pergi menukar tabung gas.`,
    struck: (event) => `Sampai pukul ${clock(event.time + catalog.gasOut.duration)}, satu pegawai pergi menukar tabung.`,
    happened: (event) =>
      `Dari pukul ${clock(event.time)} sampai ${clock(event.time + catalog.gasOut.duration)}, satu pegawai pergi menukar tabung gas.`,
  },
  viral: {
    icon: 'phone',
    name: 'Mendadak viral',
    tutorial: `Ada yang mengunggah video warungmu. Sejak itu yang datang ${compact(catalog.viral.demandFactor)} kali lipat.`,
    struck: () => `Ada yang mengunggah video warungmu! Sampai tutup, yang datang ${compact(catalog.viral.demandFactor)} kali lipat.`,
    happened: (event) =>
      `Ada yang mengunggah video warungmu. Sejak pukul ${clock(event.time)}, yang datang ${compact(catalog.viral.demandFactor)} kali lipat biasanya.`,
  },
  helper: {
    icon: 'smile',
    name: 'Keponakan ikut bantu',
    tutorial: `Keponakan Pak Erlangga ikut melayani selama ${compact(catalog.helper.duration)} jam, tanpa digaji.`,
    struck: (event) =>
      `Dia mampir sepulang sekolah dan ikut melayani sampai pukul ${clock(event.time + catalog.helper.duration)}. Gratis!`,
    happened: (event) =>
      `Dari pukul ${clock(event.time)} sampai ${clock(event.time + catalog.helper.duration)}, keponakan Pak Erlangga ikut melayani tanpa digaji.`,
  },
});

/** Each rule violation as a sentence that says what is wrong and how to fix it. */
export function problemText(code, { morningCost, cash } = {}) {
  switch (code) {
    case PROBLEM.STAFF:
      return `Pegawai harus ${LIMITS.staff.min} sampai ${LIMITS.staff.max} orang.`;
    case PROBLEM.SHIFTS:
      return `Tiap shift butuh ${LIMITS.staff.min} sampai ${LIMITS.staff.max} pegawai.`;
    case PROBLEM.SHIFTS_LOCKED:
      return 'Jadwal per shift baru bisa dipakai setelah membeli papan shift.';
    case PROBLEM.PRICE:
      return `Harga harus ${rupiah(LIMITS.price.min)} sampai ${rupiah(LIMITS.price.max)}, kelipatan ${rupiah(LIMITS.price.step)}.`;
    case PROBLEM.STOCK:
      return `Stok harus ${LIMITS.stock.min} sampai ${LIMITS.stock.max} porsi.`;
    case PROBLEM.SEATS:
      return 'Bangku yang dipasang tidak bisa melebihi bangku yang kamu punya.';
    case PROBLEM.SEATS_LIMIT:
      return `Warung hanya muat ${LIMITS.seats.max} bangku tunggu.`;
    case PROBLEM.TRAINING_MAXED:
      return 'Pelatihan sudah di level tertinggi.';
    case PROBLEM.UPGRADE:
      return 'Barang itu tidak bisa dibeli.';
    case PROBLEM.CASH:
      return `Kas tidak cukup. Belanja dan bahan pagi ini ${rupiah(morningCost)}, kasmu ${rupiah(cash)}. Kurangi stok atau keluarkan barang dari keranjang.`;
    case PROBLEM.GAME_OVER:
      return 'Permainan ini sudah selesai.';
    default:
      return 'Ada keputusan yang belum bisa dijalankan.';
  }
}
