/**
 * Formatting for display, in Indonesian conventions: a dot between
 * thousands, a comma before decimals, and a dot in clock times (12.30).
 */

import { DAY } from '../game/config.js';

const LOCALE = 'id-ID';
const whole = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const MINUS = '−'; // a real minus sign, as wide as a plus
/** A space that a line is never broken at, so "Rp" is not left behind at the end of one. */
const NBSP = '\u00a0';
/** Nothing at all, except that a line is not broken there: it keeps "12.00–13.00" in one piece. */
const JOINER = '\u2060';

/** 1550000 -> "Rp 1.550.000"; negative amounts get a minus sign in front. */
export function rupiah(amount) {
  const rounded = Math.round(amount);
  return `${rounded < 0 ? MINUS : ''}Rp${NBSP}${whole.format(Math.abs(rounded))}`;
}

/** An amount as somebody would say it: to the nearest thousand. 50326 -> "Rp 50.000". For speech, never for the books. */
export function spokenRupiah(amount) {
  return rupiah(Math.round(amount / 1000) * 1000);
}

/** Like rupiah(), with an explicit plus sign for gains. */
export function signedRupiah(amount) {
  return Math.round(amount) > 0 ? `+${rupiah(amount)}` : rupiah(amount);
}

/** 1550000 -> "Rp 1,55 jt"; for places too narrow for the full figure. */
export function shortRupiah(amount) {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? MINUS : '';
  const absolute = Math.abs(rounded);
  if (absolute >= 1_000_000) return `${sign}Rp${NBSP}${decimal(absolute / 1_000_000, 2)}${NBSP}jt`;
  // From a thousand up it is said in thousands, so "7 rb" stands beside "243 rb" and not "6.928".
  if (absolute >= 1_000) return `${sign}Rp${NBSP}${whole.format(Math.round(absolute / 1000))}${NBSP}rb`;
  return `${sign}Rp${NBSP}${whole.format(absolute)}`;
}

export function integer(value) {
  return whole.format(value).replace('-', MINUS);
}

export function decimal(value, digits = 1) {
  if (!Number.isFinite(value)) return '-';
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(value)
    .replace('-', MINUS);
}

/** Up to `digits` decimals, without trailing zeros: 12 -> "12", 14.4 -> "14,4". */
export function compact(value, digits = 1) {
  if (!Number.isFinite(value)) return '-';
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(value).replace('-', MINUS);
}

/** 0.134 -> "13%". */
export function percent(share, digits = 0) {
  if (!Number.isFinite(share)) return '-';
  return `${decimal(share * 100, digits)}%`;
}

/** A change with its sign: 4.2 -> "+4,2". */
export function signed(value, digits = 1) {
  return `${value > 0 ? '+' : ''}${decimal(value, digits)}`;
}

/** A duration given in hours, shown in minutes: 0.05 -> "3,0 menit". */
export function minutes(hours, digits = 1) {
  if (!Number.isFinite(hours)) return '-';
  return `${decimal(hours * 60, digits)} menit`;
}

/** Hours since opening -> the time on the clock: 4.5 -> "12.30". */
export function clock(hoursSinceOpening) {
  const totalMinutes = Math.round((DAY.openHour + hoursSinceOpening) * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}.${String(minute).padStart(2, '0')}`;
}

/** The hour that starts `index` hours after opening: 4 -> "12.00-13.00". */
export function hourRange(index) {
  return `${clock(index)}${JOINER}-${JOINER}${clock(index + 1)}`;
}

/** Just the starting hour, for chart axes: 4 -> "12". */
export function hourTick(index) {
  return String(DAY.openHour + index).padStart(2, '0');
}
