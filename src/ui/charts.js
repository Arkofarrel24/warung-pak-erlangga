/**
 * Charts, drawn with Chart.js from the CDN.
 *
 * Every chart here is paired, in the view that uses it, with a sentence that
 * states its main point and a table of its numbers, so nothing depends on
 * being able to see the chart or tell its colors apart. If Chart.js fails to
 * load, the views show the tables alone.
 */

import { DAY } from '../game/config.js';
import { decimal, hourTick, integer, shortRupiah } from './format.js';

export function chartsAvailable() {
  return typeof globalThis.Chart === 'function';
}

/**
 * The charts of one view. A chart measures its container when it is
 * created, so the views register how to build each chart while they
 * assemble their DOM, and build them all once that DOM is on the page.
 */
export function createChartSet() {
  const pending = [];
  const charts = [];
  return {
    /** @param {() => object} build creates one chart */
    add(build) {
      if (chartsAvailable()) pending.push(build);
    },
    /** Builds every chart registered so far. Call it after the view is in the document. */
    mount() {
      for (const build of pending.splice(0)) charts.push(build());
    },
    destroy() {
      for (const chart of charts.splice(0)) chart.destroy();
    },
  };
}

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function theme() {
  return {
    ink: token('--ink'),
    soft: token('--ink-soft'),
    grid: token('--line-soft'),
    surface: token('--surface'),
    served: token('--outcome-served'),
    reneged: token('--outcome-reneged'),
    balked: token('--outcome-balked'),
    soldOut: token('--outcome-soldout'),
    profit: token('--daun'),
    loss: token('--sambal'),
    kunyit: token('--kunyit'),
    biru: token('--biru'),
    body: token('--font-body'),
    mono: token('--font-mono'),
  };
}

function baseOptions(colors) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tick = { color: colors.soft, font: { family: colors.mono, size: 11 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion ? false : { duration: 350 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: colors.ink,
          font: { family: colors.body, size: 13, weight: 700 },
          usePointStyle: true,
          boxWidth: 10,
          boxHeight: 10,
          padding: 14,
        },
      },
      tooltip: {
        backgroundColor: colors.ink,
        titleFont: { family: colors.body, weight: 800 },
        bodyFont: { family: colors.mono },
        padding: 10,
        cornerRadius: 8,
        boxPadding: 4,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: colors.ink, width: 2 }, ticks: tick },
      y: {
        beginAtZero: true,
        grid: { color: colors.grid },
        border: { display: false },
        ticks: { ...tick, precision: 0 },
      },
    },
  };
}

/**
 * What happened in each hour: customers by how their visit ended, stacked,
 * with the utilization ρ of that hour as a line on its own axis.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object[]} hours rows from hourlyRows() in report-view.js
 */
export function createHourlyChart(canvas, hours) {
  const colors = theme();
  const options = baseOptions(colors);
  const bar = (label, key, color) => ({
    label,
    data: hours.map((hour) => hour[key]),
    backgroundColor: color,
    borderColor: colors.ink,
    borderWidth: 1.5,
    borderRadius: 3,
    stack: 'customers',
    order: 2,
  });

  options.scales.x.stacked = true;
  options.scales.x.title = { display: true, text: 'jam', color: colors.soft, font: { family: colors.body, weight: 700 } };
  options.scales.y.stacked = true;
  options.scales.y.title = { display: true, text: 'pelanggan', color: colors.soft, font: { family: colors.body, weight: 700 } };
  options.scales.rho = {
    position: 'right',
    min: 0,
    max: 1,
    grid: { display: false },
    border: { display: false },
    ticks: {
      color: colors.soft,
      font: { family: colors.mono, size: 11 },
      stepSize: 0.25,
      callback: (value) => decimal(value, 2),
    },
    title: { display: true, text: 'utilisasi ρ', color: colors.soft, font: { family: colors.body, weight: 700 } },
  };
  options.plugins.tooltip.callbacks = {
    title: ([item]) => `Jam ${hours[item.dataIndex].label}`,
    label: (item) =>
      item.dataset.yAxisID === 'rho'
        ? ` ρ ${decimal(item.parsed.y, 2)}`
        : ` ${item.dataset.label}: ${integer(item.parsed.y)}`,
  };

  return new globalThis.Chart(canvas, {
    type: 'bar',
    data: {
      labels: hours.map((hour) => hour.tick),
      datasets: [
        bar('Dilayani', 'served', colors.served),
        bar('Batal antre', 'reneged', colors.reneged),
        bar('Penuh', 'rejected', colors.balked),
        bar('Kehabisan', 'soldOut', colors.soldOut),
        {
          type: 'line',
          label: 'Utilisasi ρ',
          data: hours.map((hour) => hour.rho),
          yAxisID: 'rho',
          borderColor: colors.ink,
          backgroundColor: colors.surface,
          borderWidth: 2.5,
          borderDash: [6, 4],
          pointStyle: 'rectRot',
          pointRadius: 5,
          pointBorderWidth: 2,
          tension: 0.25,
          order: 1,
        },
      ],
    },
    options,
  });
}

/** Day labels for the trend charts: all fourteen days, so the road ahead shows too. */
const dayLabels = () => Array.from({ length: DAY.count }, (_, i) => `${i + 1}`);

/** Pads a series with nulls for the days not played yet. */
const padded = (values) => dayLabels().map((_, i) => values[i] ?? null);

function trendOptions(colors, { unit, format }) {
  const options = baseOptions(colors);
  options.plugins.legend.display = false;
  options.scales.x.ticks = { ...options.scales.x.ticks, maxRotation: 0, autoSkipPadding: 8 };
  options.scales.x.title = { display: true, text: 'hari', color: colors.soft, font: { family: colors.body, weight: 700 } };
  options.scales.y.ticks.callback = (value) => format(value);
  options.scales.y.ticks.maxTicksLimit = 6;
  options.plugins.tooltip.callbacks = {
    title: ([item]) => `Hari ${item.label}`,
    label: (item) => ` ${format(item.parsed.y)}${unit ? ` ${unit}` : ''}`,
  };
  return options;
}

/** Profit of each day as bars: above the line a gain, below it a loss. */
export function createProfitChart(canvas, profits) {
  const colors = theme();
  const options = trendOptions(colors, { format: shortRupiah });
  options.scales.y.ticks.precision = undefined;
  return new globalThis.Chart(canvas, {
    type: 'bar',
    data: {
      labels: dayLabels(),
      datasets: [
        {
          label: 'Laba',
          data: padded(profits),
          backgroundColor: profits.map((profit) => (profit < 0 ? colors.loss : colors.profit)),
          borderColor: colors.ink,
          borderWidth: 1.5,
          borderRadius: 4,
        },
      ],
    },
    options,
  });
}

function createLineChart(canvas, values, { color, min, max, suggestedMax, unit, format, pointStyle }) {
  const colors = theme();
  const options = trendOptions(colors, { unit, format });
  if (min !== undefined) options.scales.y.min = min;
  if (max !== undefined) options.scales.y.max = max;
  if (suggestedMax !== undefined) options.scales.y.suggestedMax = suggestedMax;
  options.scales.y.ticks.precision = undefined;
  return new globalThis.Chart(canvas, {
    type: 'line',
    data: {
      labels: dayLabels(),
      datasets: [
        {
          data: padded(values),
          borderColor: colors[color],
          backgroundColor: colors[color],
          borderWidth: 3,
          pointStyle,
          pointRadius: 5,
          pointBorderColor: colors.ink,
          pointBorderWidth: 1.5,
          tension: 0.25,
        },
      ],
    },
    options,
  });
}

/** Reputation at the end of each day, on its full scale of 0 to 100. */
export function createReputationChart(canvas, reputations) {
  return createLineChart(canvas, reputations, {
    color: 'kunyit',
    min: 0,
    max: 100,
    format: (value) => decimal(value, 0),
    pointStyle: 'circle',
  });
}

/** Mean waiting time of the customers served each day, in minutes. */
export function createWaitChart(canvas, waitMinutes) {
  return createLineChart(canvas, waitMinutes, {
    color: 'biru',
    min: 0,
    // Even on a day without waiting, the axis reaches two minutes.
    suggestedMax: 2,
    unit: 'menit',
    format: (value) => decimal(value, 1),
    pointStyle: 'circle',
  });
}
