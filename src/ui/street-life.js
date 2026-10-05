/**
 * The life of the street around the warung: what passes by, what the cat is
 * up to, the smoke from the kitchen, the lights at dusk, the rain.
 *
 * None of it belongs to the simulation. The customers on screen are the
 * engine's own; everything in this file is scenery, drawn around them so the
 * street does not look like a diagram. It keeps its own clock and its own
 * (unseeded) randomness on purpose: it must never touch a number of the game.
 */

import { prefersReducedMotion } from './motion.js';

const TAU = Math.PI * 2;
const between = (low, high) => low + Math.random() * (high - low);

/** Seconds between two things passing on the road, at least and at most. */
const TRAFFIC_GAP = [5, 13];
/** Seconds the cat stays put before it walks somewhere else. */
const CAT_REST = [9, 20];
const MAX_PUFFS = 14;
const BULB_COLORS = ['kunyit', 'sambal', 'daunMuda', 'biru'];

export class StreetLife {
  #still = prefersReducedMotion();
  #time = 0;
  #traffic = [];
  #nextTraffic = between(1.5, 5);
  #puffs = [];
  #nextPuff = 0;
  #cat = { x: null, target: null, rest: between(...CAT_REST), facing: 1 };
  #drops = [];

  /**
   * @param {number} dt seconds since the previous frame
   * @param {object} layout the scene's layout
   * @param {object} state
   * @param {number} state.busy how many pegawai are serving: a busy kitchen smokes more
   * @param {boolean} state.raining
   */
  update(dt, layout, { busy = 0, raining = false } = {}) {
    if (this.#still) return;
    this.#time += dt;
    const { width, unit } = layout;

    // Traffic: now and then a motorbike or a food cart crosses the picture.
    this.#nextTraffic -= dt;
    if (this.#nextTraffic <= 0 && this.#traffic.length < 2) {
      const direction = Math.random() < 0.5 ? 1 : -1;
      const kind = Math.random() < 0.6 ? 'motor' : 'cart';
      this.#traffic.push({
        kind,
        direction,
        x: direction > 0 ? -unit * 8 : width + unit * 8,
        // A cart is pushed at walking pace; a motorbike is in more of a hurry.
        speed: unit * (kind === 'motor' ? between(11, 15) : between(2.6, 3.4)),
        color: Math.floor(Math.random() * 3),
      });
      this.#nextTraffic = between(...TRAFFIC_GAP);
    }
    for (const vehicle of this.#traffic) vehicle.x += vehicle.direction * vehicle.speed * dt;
    this.#traffic = this.#traffic.filter((vehicle) => vehicle.x > -unit * 10 && vehicle.x < width + unit * 10);

    // Smoke from the kitchen, thicker while someone is cooking.
    this.#nextPuff -= dt;
    if (this.#nextPuff <= 0 && this.#puffs.length < MAX_PUFFS) {
      this.#puffs.push({ age: 0, drift: between(-0.4, 0.9), size: between(0.8, 1.2) });
      this.#nextPuff = busy > 0 ? between(0.25, 0.5) : between(0.9, 1.6);
    }
    for (const puff of this.#puffs) puff.age += dt / 3.2;
    this.#puffs = this.#puffs.filter((puff) => puff.age < 1);

    // The cat: it sits for a while, then walks to another spot.
    const cat = this.#cat;
    const home = [width * 0.07 + unit * 3.5, Math.max(width * 0.36 - unit * 3, width * 0.07 + unit * 5)];
    if (cat.x === null || cat.x > home[1] + unit || cat.x < home[0] - unit) cat.x = between(...home);
    if (cat.target === null) {
      cat.rest -= dt;
      if (cat.rest <= 0) cat.target = between(...home);
    } else {
      const step = unit * 2.4 * dt;
      cat.facing = Math.sign(cat.target - cat.x) || cat.facing;
      if (Math.abs(cat.target - cat.x) <= step) {
        cat.x = cat.target;
        cat.target = null;
        cat.rest = between(...CAT_REST);
      } else {
        cat.x += cat.facing * step;
      }
    }

    // Rain: each drop falls at a slant and starts again at the top.
    if (raining) {
      const wanted = Math.round(width / 9);
      while (this.#drops.length < wanted) {
        this.#drops.push({ x: Math.random(), y: Math.random(), speed: between(0.9, 1.4), length: between(0.8, 1.5) });
      }
      for (const drop of this.#drops) {
        drop.y += drop.speed * dt * 1.6;
        if (drop.y > 1) {
          drop.y -= 1;
          drop.x = Math.random();
        }
      }
    } else {
      this.#drops = [];
    }
  }

  /** What passes on the road. Drawn before the warung, so it passes behind it. */
  drawTraffic(context, layout, colors) {
    const { unit, ground } = layout;
    for (const vehicle of this.#traffic) {
      context.save();
      context.translate(vehicle.x, ground);
      context.scale(vehicle.direction, 1);
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.strokeStyle = colors.ink;
      context.lineWidth = 1.6;
      if (vehicle.kind === 'motor') this.#drawMotor(context, unit, colors, vehicle.color);
      else this.#drawCart(context, unit, colors, vehicle.color);
      context.restore();
    }
  }

  /** A motorbike and its rider, facing right, wheels on y = 0. */
  #drawMotor(context, unit, colors, color) {
    const wheel = unit * 0.85;
    const bounce = Math.sin(this.#time * 22) * unit * 0.05;
    // Exhaust: a few fading puffs behind
    context.fillStyle = 'rgb(42 27 18 / 0.12)';
    for (let i = 1; i <= 3; i++) {
      context.beginPath();
      context.arc(-unit * (2.6 + i * 0.9), -unit * (0.7 + i * 0.12), unit * (0.25 + i * 0.12), 0, TAU);
      context.fill();
    }
    // Wheels
    context.fillStyle = colors.ink;
    for (const x of [-unit * 1.7, unit * 1.7]) {
      context.beginPath();
      context.arc(x, -wheel, wheel, 0, TAU);
      context.fill();
      context.fillStyle = colors.paper;
      context.beginPath();
      context.arc(x, -wheel, wheel * 0.42, 0, TAU);
      context.fill();
      context.fillStyle = colors.ink;
    }
    context.translate(0, bounce);
    // Body
    context.fillStyle = [colors.sambal, colors.biru, colors.kunyit][color];
    context.beginPath();
    context.moveTo(-unit * 2.1, -unit * 1.5);
    context.lineTo(unit * 0.5, -unit * 1.5);
    context.lineTo(unit * 1.5, -unit * 2.6);
    context.lineTo(unit * 2.0, -unit * 2.6);
    context.lineTo(unit * 1.9, -unit * 1.0);
    context.lineTo(-unit * 1.9, -unit * 1.0);
    context.closePath();
    context.fill();
    context.stroke();
    // Handlebar
    context.beginPath();
    context.moveTo(unit * 1.6, -unit * 2.6);
    context.lineTo(unit * 1.3, -unit * 3.3);
    context.stroke();
    // Rider: jacket, arm, head with a helmet
    context.fillStyle = colors.ojol;
    context.beginPath();
    context.moveTo(-unit * 1.2, -unit * 1.5);
    context.lineTo(-unit * 0.9, -unit * 3.7);
    context.lineTo(unit * 0.3, -unit * 3.7);
    context.lineTo(unit * 0.2, -unit * 1.5);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(unit * 0.1, -unit * 3.2);
    context.lineTo(unit * 1.3, -unit * 3.1);
    context.stroke();
    context.fillStyle = colors.skins[color % colors.skins.length];
    context.beginPath();
    context.arc(-unit * 0.25, -unit * 4.4, unit * 0.78, 0, TAU);
    context.fill();
    context.stroke();
    context.fillStyle = colors.ojol;
    context.beginPath();
    context.arc(-unit * 0.25, -unit * 4.5, unit * 0.9, Math.PI, 0);
    context.closePath();
    context.fill();
    context.stroke();
  }

  /** A food cart (gerobak) and the vendor pushing it, facing right, wheels on y = 0. */
  #drawCart(context, unit, colors, color) {
    const stride = Math.sin(this.#time * 7);
    // The vendor, behind the cart
    const vendorX = -unit * 3.6;
    context.lineWidth = unit * 0.4;
    context.beginPath();
    context.moveTo(vendorX - unit * 0.3, -unit * 1.2);
    context.lineTo(vendorX - unit * 0.3 + stride * unit * 0.5, 0);
    context.moveTo(vendorX + unit * 0.3, -unit * 1.2);
    context.lineTo(vendorX + unit * 0.3 - stride * unit * 0.5, 0);
    context.stroke();
    context.lineWidth = 1.6;
    context.fillStyle = colors.shirts[(color + 2) % colors.shirts.length];
    context.beginPath();
    context.rect(vendorX - unit * 0.85, -unit * 3.2, unit * 1.7, unit * 2.1);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(vendorX + unit * 0.6, -unit * 2.5);
    context.lineTo(-unit * 2.2, -unit * 2.3);
    context.stroke();
    context.fillStyle = colors.skins[(color + 1) % colors.skins.length];
    context.beginPath();
    context.arc(vendorX, -unit * 3.9, unit * 0.8, 0, TAU);
    context.fill();
    context.stroke();
    // A caping, the cone hat of someone who walks in the sun all day
    context.fillStyle = colors.woodLight;
    context.beginPath();
    context.moveTo(vendorX - unit * 1.3, -unit * 4.3);
    context.lineTo(vendorX, -unit * 5.3);
    context.lineTo(vendorX + unit * 1.3, -unit * 4.3);
    context.closePath();
    context.fill();
    context.stroke();

    // The cart: a box on two wheels with a little roof and a pane of glass
    context.fillStyle = [colors.toska, colors.bata, colors.biru][color];
    context.fillRect(-unit * 2.2, -unit * 2.9, unit * 4.4, unit * 2.1);
    context.strokeRect(-unit * 2.2, -unit * 2.9, unit * 4.4, unit * 2.1);
    context.fillStyle = colors.krem;
    context.fillRect(-unit * 1.7, -unit * 4.6, unit * 3.4, unit * 1.7);
    context.strokeRect(-unit * 1.7, -unit * 4.6, unit * 3.4, unit * 1.7);
    context.fillStyle = colors.genteng;
    context.beginPath();
    context.moveTo(-unit * 2.5, -unit * 4.6);
    context.lineTo(-unit * 1.9, -unit * 5.4);
    context.lineTo(unit * 1.9, -unit * 5.4);
    context.lineTo(unit * 2.5, -unit * 4.6);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = colors.ink;
    context.font = `800 ${Math.round(unit * 0.95)}px ${colors.display}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // Mirrored carts would show their lettering backwards, so it is turned back.
    context.save();
    context.scale(Math.sign(context.getTransform().a) || 1, 1);
    context.fillStyle = colors.krem;
    context.fillText('BAKSO', 0, -unit * 1.8);
    context.restore();
    context.fillStyle = colors.ink;
    for (const x of [-unit * 1.2, unit * 1.2]) {
      context.beginPath();
      context.arc(x, -unit * 0.75, unit * 0.75, 0, TAU);
      context.fill();
    }
  }

  /** Smoke rising from the kitchen at the back of the warung. Drawn over the roof. */
  drawSmoke(context, layout) {
    const { unit, stallX, stallWidth, roof } = layout;
    const x = stallX + stallWidth * 0.82;
    const y = roof - unit * 3.1;
    // The vent pipe it comes out of
    context.fillStyle = 'rgb(94 74 59)';
    context.strokeStyle = 'rgb(42 27 18)';
    context.lineWidth = 1.6;
    context.fillRect(x - unit * 0.45, y - unit * 1.1, unit * 0.9, unit * 1.5);
    context.strokeRect(x - unit * 0.45, y - unit * 1.1, unit * 0.9, unit * 1.5);
    context.fillRect(x - unit * 0.7, y - unit * 1.4, unit * 1.4, unit * 0.4);
    context.strokeRect(x - unit * 0.7, y - unit * 1.4, unit * 1.4, unit * 0.4);

    for (const puff of this.#puffs) {
      const rise = puff.age * unit * 6.5;
      context.fillStyle = `rgb(255 255 255 / ${0.55 * (1 - puff.age)})`;
      context.beginPath();
      context.arc(x + puff.drift * puff.age * unit * 3, y - unit * 1.6 - rise, unit * (0.45 + puff.age * 1.1) * puff.size, 0, TAU);
      context.fill();
    }
  }

  /**
   * A string of colored bulbs under the eave. They are always there, and
   * come on toward evening.
   */
  drawLights(context, layout, colors, lit) {
    const { unit, stallX, stallWidth, roof } = layout;
    const left = stallX - unit * 2.1;
    const right = stallX + stallWidth + unit * 2.1;
    // Along the edge of the roof, above the banner.
    const y = roof + unit * 0.3;
    const count = Math.max(Math.round((right - left) / (unit * 2.3)), 5);
    context.strokeStyle = 'rgb(42 27 18 / 0.75)';
    context.lineWidth = 1.1;
    context.beginPath();
    for (let i = 0; i < count; i++) {
      const x0 = left + ((right - left) * i) / count;
      const x1 = left + ((right - left) * (i + 1)) / count;
      context.moveTo(x0, y);
      context.quadraticCurveTo((x0 + x1) / 2, y + unit * 0.5, x1, y);
    }
    context.stroke();
    for (let i = 0; i < count; i++) {
      const x = left + ((right - left) * (i + 0.5)) / count;
      const bulbY = y + unit * 0.42;
      const color = colors[BULB_COLORS[i % BULB_COLORS.length]];
      // Lit bulbs twinkle a little, each at its own pace.
      const twinkle = lit ? 0.8 + 0.2 * Math.sin(this.#time * 3 + i * 1.7) : 0;
      if (lit) {
        const glow = context.createRadialGradient(x, bulbY, 0, x, bulbY, unit * 1.6);
        glow.addColorStop(0, `rgb(255 232 150 / ${0.55 * twinkle})`);
        glow.addColorStop(1, 'rgb(255 232 150 / 0)');
        context.fillStyle = glow;
        context.fillRect(x - unit * 1.6, bulbY - unit * 1.6, unit * 3.2, unit * 3.2);
      }
      context.globalAlpha = lit ? 1 : 0.55;
      context.fillStyle = color;
      context.strokeStyle = colors.ink;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(x, bulbY, unit * 0.3, 0, TAU);
      context.fill();
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  /** The warung's cat. Drawn on the pavement, before the customers, who walk past it. */
  drawCat(context, layout, colors) {
    const { unit, ground } = layout;
    const cat = this.#cat;
    if (cat.x === null) return;
    const walking = cat.target !== null;
    const tail = Math.sin(this.#time * (walking ? 6 : 2.2)) * 0.5;
    const step = walking ? Math.sin(this.#time * 12) : 0;

    context.save();
    context.translate(cat.x, ground);
    context.scale(cat.facing, 1);
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = colors.ink;
    context.lineWidth = 1.4;
    context.fillStyle = colors.shirts[4];

    // Tail
    context.beginPath();
    context.moveTo(-unit * 0.8, -unit * 0.7);
    context.quadraticCurveTo(-unit * (1.6 + tail * 0.3), -unit * 1.0, -unit * (1.5 - tail * 0.5), -unit * 2.0);
    context.lineWidth = unit * 0.3;
    context.stroke();
    context.lineWidth = 1.4;

    if (walking) {
      // Legs
      context.beginPath();
      for (const [x, phase] of [[-0.6, 1], [-0.3, -1], [0.4, -1], [0.7, 1]]) {
        context.moveTo(x * unit, -unit * 0.6);
        context.lineTo((x + step * phase * 0.25) * unit, 0);
      }
      context.stroke();
      context.beginPath();
      context.ellipse(0, -unit * 0.85, unit * 1.05, unit * 0.48, 0, 0, TAU);
      context.fill();
      context.stroke();
    } else {
      // Sitting upright
      context.beginPath();
      context.ellipse(-unit * 0.1, -unit * 0.75, unit * 0.72, unit * 0.78, 0, 0, TAU);
      context.fill();
      context.stroke();
    }

    // Head, ears, face
    const headX = unit * (walking ? 1.0 : 0.45);
    const headY = -unit * (walking ? 1.25 : 1.75);
    context.beginPath();
    context.moveTo(headX - unit * 0.5, headY - unit * 0.25);
    context.lineTo(headX - unit * 0.38, headY - unit * 0.85);
    context.lineTo(headX - unit * 0.05, headY - unit * 0.45);
    context.moveTo(headX + unit * 0.05, headY - unit * 0.45);
    context.lineTo(headX + unit * 0.38, headY - unit * 0.85);
    context.lineTo(headX + unit * 0.5, headY - unit * 0.25);
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(headX, headY, unit * 0.52, 0, TAU);
    context.fill();
    context.stroke();
    // It blinks slowly, the way cats do at people they tolerate.
    const blink = Math.sin(this.#time * 0.9) > 0.96;
    context.fillStyle = colors.ink;
    for (const dx of [-0.2, 0.22]) {
      context.beginPath();
      if (blink) context.rect(headX + dx * unit - unit * 0.09, headY - unit * 0.05, unit * 0.18, 1);
      else context.arc(headX + dx * unit, headY - unit * 0.05, Math.max(unit * 0.08, 0.8), 0, TAU);
      context.fill();
    }
    context.restore();
  }

  /** Rain over the whole picture: a grey veil and slanting streaks. Drawn last. */
  drawRain(context, layout) {
    const { width, height, unit, ground } = layout;
    context.fillStyle = 'rgb(70 90 110 / 0.2)';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgb(255 255 255 / 0.6)';
    context.lineWidth = 1.2;
    context.lineCap = 'round';
    context.beginPath();
    if (this.#still) {
      // Without motion the rain is drawn standing still.
      for (let i = 0; i < width / 9; i++) {
        const x = ((i * 97) % 100) / 100;
        const y = ((i * 61) % 100) / 100;
        context.moveTo(x * width, y * height);
        context.lineTo(x * width - unit * 0.45, y * height + unit * 1.2);
      }
    }
    for (const drop of this.#drops) {
      const x = drop.x * (width + unit * 6) - drop.y * unit * 5;
      const y = drop.y * height;
      context.moveTo(x, y);
      context.lineTo(x - unit * 0.4 * drop.length, y + unit * 1.1 * drop.length);
    }
    context.stroke();
    // Splashes where the drops meet the pavement
    context.strokeStyle = 'rgb(255 255 255 / 0.45)';
    context.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const phase = (this.#time * 1.6 + i * 0.37) % 1;
      const x = ((i * 0.151 + 0.07) % 1) * width;
      const y = ground + (height - ground) * (0.2 + ((i * 0.37) % 0.7));
      context.globalAlpha = 1 - phase;
      context.beginPath();
      context.ellipse(x, y, unit * (0.2 + phase * 0.9), unit * (0.08 + phase * 0.25), 0, 0, TAU);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
}
