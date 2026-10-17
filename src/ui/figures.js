/**
 * The little people of the street scene, drawn once more as still pictures.
 *
 * The scene itself is painted on a canvas (see warung-scene.js). The front
 * page explains what its marks mean, and for that it needs the same figures
 * standing still next to a sentence. They are drawn here as SVG with the
 * proportions of the canvas figures, so what the tutorial shows is what the
 * player then sees moving.
 */

import { svg } from './dom.js';

/** Every figure is sized in units, as in the scene. */
const U = 8;
const INK = 'stroke: var(--ink); stroke-linejoin: round; stroke-linecap: round';
const point = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/**
 * A small person: round head, a body in a colored shirt, two legs.
 * `y` is where the feet are.
 */
function person(x, y, { shirt, skin = 'var(--kulit-1)', mood = 'calm', seated = false, bag = false, jilbab = null }) {
  const hipY = y - U * (seated ? 0.95 : 1.15);
  const bodyTop = hipY - U * 1.95;
  const headY = bodyTop - U * 0.72;
  const parts = [];

  // Legs
  const legs = seated
    ? `M${point(x - U * 0.3, hipY)} L${point(x + U * 0.55, hipY + U * 0.1)} L${point(x + U * 0.55, y)} ` +
      `M${point(x + U * 0.3, hipY)} L${point(x + U, hipY + U * 0.1)} L${point(x + U, y)}`
    : `M${point(x - U * 0.35, hipY)} L${point(x - U * 0.35, y)} M${point(x + U * 0.35, hipY)} L${point(x + U * 0.35, y)}`;
  parts.push(svg('path', { d: legs, style: `${INK}; stroke-width: ${U * 0.42}; fill: none` }));

  // Body
  parts.push(
    svg('rect', {
      x: x - U * 0.9,
      y: bodyTop,
      width: U * 1.8,
      height: U * 2.1,
      rx: U * 0.5,
      style: `${INK}; stroke-width: 1.6; fill: ${shirt}`,
    }),
  );

  // A plastic bag of food to take home
  if (bag) {
    const bagX = x + U * 1.05;
    const bagY = hipY - U * 0.35;
    parts.push(
      svg('path', {
        d: `M${point(bagX - U * 0.32, bagY - U * 0.1)} A${U * 0.32} ${U * 0.32} 0 0 1 ${point(bagX + U * 0.32, bagY - U * 0.1)}`,
        style: `${INK}; stroke-width: 1.6; fill: none`,
      }),
      svg('path', {
        d:
          `M${point(bagX - U * 0.42, bagY - U * 0.1)} L${point(bagX + U * 0.42, bagY - U * 0.1)} ` +
          `L${point(bagX + U * 0.55, bagY + U * 0.85)} L${point(bagX - U * 0.55, bagY + U * 0.85)} Z`,
        style: `${INK}; stroke-width: 1.6; fill: var(--krem)`,
      }),
    );
  }

  // Head
  if (jilbab) {
    const r = U * 1.02;
    parts.push(
      svg('path', {
        d:
          `M${point(x - r * 0.988, headY + r * 0.156)} A${r} ${r} 0 1 1 ${point(x + r * 0.988, headY + r * 0.156)} ` +
          `L${point(x + U * 0.95, bodyTop + U * 0.75)} L${point(x - U * 0.95, bodyTop + U * 0.75)} Z`,
        style: `${INK}; stroke-width: 1.6; fill: ${jilbab}`,
      }),
      svg('ellipse', { cx: x, cy: headY + U * 0.08, rx: U * 0.6, ry: U * 0.66, style: `${INK}; stroke-width: 1.6; fill: ${skin}` }),
    );
  } else {
    const r = U * 0.82;
    const hairY = headY - U * 0.12;
    parts.push(
      svg('circle', { cx: x, cy: headY, r, style: `${INK}; stroke-width: 1.6; fill: ${skin}` }),
      svg('path', {
        d: `M${point(x - r * 0.969, hairY - r * 0.249)} A${r} ${r} 0 0 1 ${point(x + r * 0.969, hairY - r * 0.249)} Z`,
        style: 'fill: var(--ink)',
      }),
    );
  }

  // Face
  for (const side of [-1, 1]) {
    parts.push(svg('circle', { cx: x + side * U * 0.3, cy: headY + U * 0.05, r: 1, style: 'fill: var(--ink)' }));
  }
  if (mood === 'happy') {
    const r = U * 0.26;
    const cy = headY + U * 0.25;
    parts.push(
      svg('path', {
        d: `M${point(x + r * 0.891, cy + r * 0.454)} A${r} ${r} 0 0 1 ${point(x - r * 0.891, cy + r * 0.454)}`,
        style: `${INK}; stroke-width: 1.2; fill: none`,
      }),
    );
  } else if (mood === 'angry' || mood === 'sad') {
    const r = U * 0.24;
    const cy = headY + U * 0.62;
    parts.push(
      svg('path', {
        d: `M${point(x - r * 0.809, cy - r * 0.588)} A${r} ${r} 0 0 1 ${point(x + r * 0.809, cy - r * 0.588)}`,
        style: `${INK}; stroke-width: 1.2; fill: none`,
      }),
    );
  }
  if (mood === 'angry') {
    const eye = U * 0.3;
    parts.push(
      svg('path', {
        d:
          `M${point(x - eye - U * 0.2, headY - U * 0.28)} L${point(x - eye + U * 0.16, headY - U * 0.12)} ` +
          `M${point(x + eye + U * 0.2, headY - U * 0.28)} L${point(x + eye - U * 0.16, headY - U * 0.12)}`,
        style: `${INK}; stroke-width: 1.2; fill: none`,
      }),
    );
  }

  return { parts, headY: seated ? y - U * 3.35 : y - U * 3.85 };
}

/** A plastic stool. `y` is the ground. */
function stool(x, y, color) {
  return [
    svg('path', {
      d:
        `M${point(x - U * 0.85, y - U * 1.3)} L${point(x + U * 0.85, y - U * 1.3)} ` +
        `L${point(x + U * 1.15, y)} L${point(x - U * 1.15, y)} Z`,
      style: `${INK}; stroke-width: 1.6; fill: ${color}`,
    }),
    svg('rect', {
      x: x - U * 0.42,
      y: y - U * 0.72,
      width: U * 0.84,
      height: U * 0.5,
      rx: U * 0.2,
      style: 'fill: rgb(42 27 18 / 0.28)',
    }),
  ];
}

/** A small badge over a head: why this customer is leaving. */
function badge(x, y, color, glyph) {
  const parts = [svg('circle', { cx: x, cy: y, r: U * 0.85, style: `${INK}; stroke-width: 1.5; fill: ${color}` })];
  if (glyph === 'plate') {
    // Nothing left: an empty plate with a line through it.
    const r = U * 0.42;
    parts.push(
      svg('circle', { cx: x, cy: y, r, style: 'fill: none; stroke: #fff; stroke-width: 1.6' }),
      svg('path', {
        d: `M${point(x - r, y + r)} L${point(x + r, y - r)}`,
        style: 'fill: none; stroke: #fff; stroke-width: 1.6; stroke-linecap: round',
      }),
    );
  } else {
    parts.push(
      svg('text', {
        x,
        y: y + U * 0.45,
        'text-anchor': 'middle',
        style: `font: 800 ${U * 1.3}px var(--font-display); fill: ${glyph === '×' ? 'var(--ink)' : '#fff'}`,
        text: glyph,
      }),
    );
  }
  return parts;
}

const GROUND = 68;
const CENTER = 32;

const FIGURES = {
  /** Waiting on a stool, with the patience bar over the head. */
  patience() {
    const { parts, headY } = person(CENTER - 2, GROUND, { shirt: 'var(--baju-1)', seated: true });
    const width = U * 2.3;
    const x = CENTER - 2 - width / 2;
    const y = headY - U * 1.7;
    return [
      ...stool(CENTER - 2, GROUND, 'var(--sambal)'),
      ...parts,
      svg('rect', { x, y, width, height: 4.5, rx: 2, style: `${INK}; stroke-width: 1.2; fill: var(--surface)` }),
      svg('rect', { x: x + 0.8, y: y + 0.8, width: (width - 1.6) * 0.45, height: 2.9, rx: 1.4, style: 'fill: var(--kunyit)' }),
    ];
  },
  /** At the counter, with the service ring closing around the head. */
  service() {
    const { parts, headY } = person(CENTER, GROUND, { shirt: 'var(--baju-3)', jilbab: 'var(--baju-5)', skin: 'var(--kulit-3)' });
    const r = U * 1.25;
    return [
      ...parts,
      // Three quarters of the way round.
      svg('path', {
        d: `M${point(CENTER, headY - r)} A${r} ${r} 0 1 1 ${point(CENTER - r, headY)}`,
        style: 'fill: none; stroke: var(--kunyit); stroke-width: 2.8; stroke-linecap: round',
      }),
    ];
  },
  /** Served: going home with a bag, and the price rising from the counter. */
  served() {
    const { parts } = person(CENTER - 6, GROUND, { shirt: 'var(--baju-4)', mood: 'happy', bag: true, skin: 'var(--kulit-2)' });
    return [
      ...parts,
      svg('text', {
        x: CENTER + 2,
        y: 20,
        'text-anchor': 'middle',
        style: `font: 800 ${U * 1.5}px var(--font-display); fill: var(--outcome-served); stroke: var(--surface); stroke-width: 3; paint-order: stroke`,
        text: '+10 rb',
      }),
    ];
  },
  /** A tip: a coin on the counter top, with the ring that says how long it will lie there. */
  tip() {
    const counter = GROUND - U * 2.2;
    const coinY = counter - U * 1.55;
    const r = U * 1.55;
    const ring = U * 2.25;
    return [
      // The front of the counter, in the paint of the warung, and its wooden top.
      svg('rect', { x: 6, y: counter + U * 0.9, width: 52, height: GROUND - counter - U * 0.9, style: `${INK}; stroke-width: 1.6; fill: var(--toska)` }),
      svg('rect', { x: 6, y: counter + U * 1.5, width: 52, height: U * 0.6, style: 'fill: var(--kunyit)' }),
      svg('rect', { x: 3, y: counter, width: 58, height: U * 1.1, rx: U * 0.3, style: `${INK}; stroke-width: 1.6; fill: var(--kayu)` }),
      // The ring, three quarters of it left.
      svg('path', {
        d: `M${point(CENTER, coinY - ring)} A${ring} ${ring} 0 1 1 ${point(CENTER - ring, coinY)}`,
        style: 'fill: none; stroke: var(--ink); stroke-width: 2.4; stroke-linecap: round',
      }),
      svg('circle', { cx: CENTER, cy: coinY, r, style: `${INK}; stroke-width: 1.6; fill: var(--kunyit)` }),
      svg('circle', { cx: CENTER, cy: coinY, r: r - 3, style: 'fill: none; stroke: var(--kunyit-deep); stroke-width: 2; opacity: 0.6' }),
      svg('text', {
        x: CENTER,
        y: coinY + U * 0.5,
        'text-anchor': 'middle',
        style: `font: 800 ${U * 1.25}px var(--font-display); fill: var(--ink)`,
        text: 'Rp',
      }),
    ];
  },
  /** Gave up waiting. */
  reneged() {
    const { parts, headY } = person(CENTER, GROUND, { shirt: 'var(--baju-2)', mood: 'angry' });
    return [...parts, ...badge(CENTER, headY - U * 1.9, 'var(--outcome-reneged)', '!')];
  },
  /** Found every stool taken. */
  balked() {
    const { parts, headY } = person(CENTER, GROUND, { shirt: 'var(--baju-6)', mood: 'sad', skin: 'var(--kulit-4)' });
    return [...parts, ...badge(CENTER, headY - U * 1.9, 'var(--outcome-balked)', '×')];
  },
  /** Came after the food ran out. */
  soldOut() {
    const { parts, headY } = person(CENTER, GROUND, { shirt: 'var(--baju-5)', mood: 'sad', jilbab: 'var(--baju-1)', skin: 'var(--kulit-3)' });
    return [...parts, ...badge(CENTER, headY - U * 1.9, 'var(--outcome-soldout)', 'plate')];
  },
  /** The waiting stools, drawn larger: there is nobody on them to give the scale. */
  stools() {
    return [
      svg('g', { transform: `translate(${CENTER} ${GROUND}) scale(1.45) translate(${-CENTER} ${-GROUND})` }, [
        ...stool(CENTER - 11, GROUND - 9, 'var(--biru)'),
        ...stool(CENTER + 9, GROUND - 4, 'var(--daun)'),
        ...stool(CENTER - 6, GROUND, 'var(--sambal)'),
      ]),
    ];
  },
};

/**
 * One of the scene's figures as a still picture.
 *
 * @param {keyof typeof FIGURES} name
 */
export function figure(name) {
  return svg('svg', { class: 'figure', viewBox: '0 0 64 72', 'aria-hidden': 'true', focusable: 'false' }, [
    svg('ellipse', { cx: CENTER, cy: GROUND + 1, rx: 24, ry: 3, style: 'fill: rgb(42 27 18 / 0.1)' }),
    ...FIGURES[name](),
  ]);
}
