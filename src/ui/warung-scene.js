/**
 * The warung, drawn on a canvas.
 *
 * This class does not run the simulation. It is told what the simulation
 * engine did (one event at a time) and what state the engine is in, and it
 * moves one little figure per customer accordingly. What is on screen is
 * therefore the real state of the queue, not an imitation of it:
 *
 *   - a figure on a stool is a customer in the waiting line, in the order
 *     the engine will call them;
 *   - the bar over their head is their own patience, drawn from the same
 *     exponential distribution the engine uses, running out in real time;
 *   - a figure at the counter is in service, and the ring around their head
 *     closes exactly when that service ends;
 *   - a figure walking off to the right has been served; one stomping back
 *     to the left gave up (reneging) or found no seat (balking).
 *
 * The layout is a street seen from the side. Customers come in from the
 * left, wait on the plastic stools, are served at the counter, and leave to
 * the right.
 *
 * The place is drawn as an Indonesian warung, not a market stall: a clay-tile
 * roof, a painted wooden front, a cloth banner with its name, a glass
 * display case of dishes, strings of sachets and a bunch of bananas hanging
 * from the eave, a tin of kerupuk. Behind it, a kampung with a mosque, two
 * mountains, a coconut palm, and a power pole with its tangle of wires.
 */

import { ARRIVAL_OUTCOME, EVENT } from '../sim/engine.js';
import { StreetLife } from './street-life.js';

const TAU = Math.PI * 2;

const STATE = Object.freeze({
  QUEUE: 'queue',
  SERVICE: 'service',
  TURNING: 'turning', //   came to the door and is about to turn back
  HAPPY: 'happy', //       served, leaving to the right
  ANGRY: 'angry', //       gave up waiting, leaving to the left
  SAD: 'sad', //           sent away when the stock ran out
});

/** Reasons for turning back at the door. */
const MARK = Object.freeze({ FULL: 'full', EMPTY: 'empty' });

/** Seconds for a figure to cover about 63% of the way to where it is going. */
const GLIDE_SECONDS = 0.16;
/** Seconds a customer stands at the door before turning back. */
const HESITATE_SECONDS = 0.5;
const MAX_FLOATERS = 7;
/** Hours since opening at which the lamps come on (17.30). */
const LIGHTS_ON = 9.5;

/**
 * The sky through the day, as [hours since opening, top color, bottom color].
 * Opening at 08:00: a pale morning, a bright noon, an orange late afternoon,
 * and dusk at closing time. After that it is night.
 */
const SKY = [
  [0, '#cfe6ee', '#fbeed2'],
  [4, '#b9def0', '#fff5da'],
  [8, '#f6d9a8', '#ffe8c4'],
  [10.5, '#f0a67a', '#fbd0a0'],
  [12, '#6a6aa0', '#d79a84'],
  [13.2, '#2c3260', '#5d5378'],
  [14, '#2c3260', '#5d5378'],
  // Dawn, for the endless street on the front page, which starts its day over.
  [14.5, '#cfe6ee', '#fbeed2'],
];

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
const rgb = (color, alpha = 1) => `rgb(${color[0]} ${color[1]} ${color[2]} / ${alpha})`;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Top and bottom color of the sky at a given hour, blended between the entries of SKY. */
function skyAt(hour) {
  const last = SKY.length - 1;
  if (hour <= SKY[0][0]) return [hexToRgb(SKY[0][1]), hexToRgb(SKY[0][2])];
  if (hour >= SKY[last][0]) return [hexToRgb(SKY[last][1]), hexToRgb(SKY[last][2])];
  const next = SKY.findIndex((entry) => entry[0] > hour);
  const [h0, top0, bottom0] = SKY[next - 1];
  const [h1, top1, bottom1] = SKY[next];
  const t = (hour - h0) / (h1 - h0);
  return [mix(hexToRgb(top0), hexToRgb(top1), t), mix(hexToRgb(bottom0), hexToRgb(bottom1), t)];
}

export class WarungScene {
  #canvas;
  #context;
  #colors;
  #seats = 2;
  #maxServers = 2;
  #priceLabel = null;
  #layout = null;
  /** @type {Map<number, object>} one figure per customer id */
  #actors = new Map();
  #floaters = [];
  #staff = 1;
  #busy = [];
  #soldOut = false;
  /** Seconds since drawing started; drives every small idle movement. */
  #time = 0;
  /** The scenery that is not the simulation: traffic, the cat, smoke, lights, rain. */
  #life = new StreetLife();
  #weather = null;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} options
   * @param {number} options.seats      waiting seats, K - c
   * @param {number} options.maxServers the most pegawai on duty at once
   * @param {string} [options.priceLabel] shown rising from the counter at each sale
   * @param {'rain' | null} [options.weather] rain falls all day
   */
  constructor(canvas, options) {
    this.#canvas = canvas;
    this.#context = canvas.getContext('2d');
    // Read from the document, not the canvas: the canvas may not be on the
    // page yet, and an element outside the page has no computed style.
    const style = getComputedStyle(document.documentElement);
    const token = (name) => style.getPropertyValue(name).trim();
    this.#colors = {
      ink: token('--ink'),
      surface: token('--surface'),
      paper: token('--paper'),
      kunyit: token('--kunyit'),
      sambal: token('--sambal'),
      daun: token('--daun'),
      biru: token('--biru'),
      bata: token('--bata'),
      krem: token('--krem'),
      toska: token('--toska'),
      toskaDeep: token('--toska-deep'),
      genteng: token('--genteng'),
      gentengDeep: token('--genteng-deep'),
      ojol: token('--ojol'),
      daunMuda: token('--daun-muda'),
      wood: token('--teh'),
      woodLight: token('--kayu'),
      ground: token('--tanah'),
      served: token('--outcome-served'),
      reneged: token('--outcome-reneged'),
      balked: token('--outcome-balked'),
      soldOut: token('--outcome-soldout'),
      shirts: [1, 2, 3, 4, 5, 6].map((n) => token(`--baju-${n}`)),
      skins: [1, 2, 3, 4].map((n) => token(`--kulit-${n}`)),
      display: token('--font-display'),
    };
    this.configure(options);
  }

  configure({ seats, maxServers, priceLabel = null, weather = null }) {
    this.#seats = seats;
    this.#maxServers = maxServers;
    this.#priceLabel = priceLabel;
    this.#weather = weather;
    this.reset();
    this.resize();
  }

  reset() {
    this.#actors.clear();
    this.#floaters = [];
    this.#soldOut = false;
  }

  /** Recomputes the layout from the canvas's current width. */
  resize() {
    const canvas = this.#canvas;
    const width = canvas.clientWidth;
    if (width === 0) return;

    const compact = width < 520;
    // Every figure is sized in units, and the unit follows the width of the scene.
    const unit = clamp(width / 60, 6, 13);
    const height = Math.round(clamp(width * 0.4, 210, 350));
    const ground = height - unit * 4.6;
    const exitZone = unit * (compact ? 5 : 8);

    // The stall: one slot of counter per pegawai.
    const slot = clamp((width * 0.36) / this.#maxServers, unit * 3.4, unit * 6);
    // The glass display case of dishes stands at the far end of the counter.
    const caseWidth = unit * 5;
    const stallWidth = slot * this.#maxServers + unit * 2.4 + caseWidth;
    const stallX = width - exitZone - stallWidth;
    const counterTop = ground - unit * 4.6;
    const roof = counterTop - unit * 7.2;
    const booths = Array.from({ length: this.#maxServers }, (_, i) => stallX + unit * 1.2 + slot * (i + 0.5));

    // The waiting stools, head of the line nearest the counter.
    const head = stallX - unit * 3;
    const spacing = clamp((head - unit * 5) / Math.max(this.#seats, 1), unit * 2.1, unit * 4.4);
    const stools = Array.from({ length: this.#seats }, (_, k) => head - k * spacing);
    // Where a customer who finds no seat stops and turns around.
    const door = Math.max(head - this.#seats * spacing, unit * 3);

    const ratio = window.devicePixelRatio || 1;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    this.#context.setTransform(ratio, 0, 0, ratio, 0, 0);

    this.#layout = {
      width,
      height,
      unit,
      ground,
      stallX,
      stallWidth,
      slot,
      counterTop,
      roof,
      booths,
      caseX: stallX + slot * this.#maxServers + unit * 1.8,
      caseWidth,
      stools,
      door,
      entrance: -unit * 3,
      exit: width + unit * 3,
    };
  }

  /**
   * Reacts to one event of the engine. Only called while events come slowly
   * enough to watch; at high speed the figures are snapped into place by
   * sync() instead.
   */
  handle(record) {
    const layout = this.#layout;
    if (!layout) return;
    const { unit } = layout;

    if (record.type === EVENT.BATCH_ARRIVAL) {
      // A group: each member is shown as the arrival they are.
      for (const arrival of record.arrivals) this.handle({ type: EVENT.ARRIVAL, time: record.time, ...arrival });
      this.#float('rombongan!', layout.door, layout.ground - unit * 8.5, this.#colors.bata);
      return;
    }

    if (record.type === EVENT.ARRIVAL) {
      const turnedBack =
        record.outcome === ARRIVAL_OUTCOME.REJECTED || record.outcome === ARRIVAL_OUTCOME.SOLD_OUT;
      if (!turnedBack) return; // sync() seats or serves everyone else
      const actor = this.#spawn(record.customer);
      actor.state = STATE.TURNING;
      actor.mark = record.outcome === ARRIVAL_OUTCOME.REJECTED ? MARK.FULL : MARK.EMPTY;
      // Those turned back together do not all stand on the same spot.
      actor.targetX = layout.door - unit * (2.5 + (record.customer.id % 5) * 1.3);
      actor.targetY = layout.ground;
      actor.hesitate = HESITATE_SECONDS;
      this.#float(record.outcome === ARRIVAL_OUTCOME.REJECTED ? 'penuh' : 'habis', actor.targetX, layout.ground - unit * 6, record.outcome === ARRIVAL_OUTCOME.REJECTED ? this.#colors.balked : this.#colors.soldOut);
    } else if (record.type === EVENT.DEPARTURE) {
      const actor = this.#actors.get(record.customer.id);
      if (!actor) return;
      actor.state = STATE.HAPPY;
      actor.targetX = layout.exit;
      actor.targetY = layout.ground + unit * 1.6;
      const booth = layout.booths[record.serverIndex] ?? actor.x;
      if (this.#priceLabel) this.#float(this.#priceLabel, booth, layout.counterTop - unit * 2, this.#colors.served);
    } else if (record.type === EVENT.RENEGE) {
      this.#leaveUnserved(record.customer, STATE.ANGRY);
      const actor = this.#actors.get(record.customer.id);
      if (actor) this.#float('kelamaan!', actor.x, layout.ground - unit * 6.4, this.#colors.reneged);
    } else if (record.type === EVENT.SOLD_OUT) {
      for (const customer of record.dismissed) {
        this.#leaveUnserved(customer, STATE.SAD);
        const actor = this.#actors.get(customer.id);
        if (actor) actor.mark = MARK.EMPTY;
      }
    }
  }

  /**
   * Brings the figures in line with the state of the simulation.
   *
   * @param {import('../sim/engine.js').QueueSimulation} simulation
   * @param {boolean} animate false = figures jump straight to their place
   */
  sync(simulation, animate) {
    const layout = this.#layout;
    if (!layout) return;
    const { unit, ground, booths, stools } = layout;
    const present = new Set();

    const place = (customer, x, y, state) => {
      let actor = this.#actors.get(customer.id);
      if (!actor) {
        actor = this.#spawn(customer);
        if (!animate) {
          actor.x = x;
          actor.y = y;
        }
      }
      actor.state = state;
      actor.targetX = x;
      actor.targetY = y;
      if (!animate) {
        actor.x = x;
        actor.y = y;
      }
      present.add(customer.id);
    };

    simulation.servers.forEach((customer, i) => {
      if (customer) place(customer, booths[i], ground + unit * 0.9, STATE.SERVICE);
    });
    simulation.line.peek(stools.length).forEach((customer, k) => place(customer, stools[k], ground, STATE.QUEUE));

    // Anyone the engine no longer holds and who was not seen leaving.
    for (const actor of this.#actors.values()) {
      const inside = actor.state === STATE.QUEUE || actor.state === STATE.SERVICE;
      if (!inside || present.has(actor.id)) continue;
      if (animate) {
        const served = actor.state === STATE.SERVICE;
        actor.state = served ? STATE.HAPPY : STATE.ANGRY;
        actor.targetX = served ? layout.exit : layout.entrance;
      } else {
        this.#actors.delete(actor.id);
      }
    }
    if (!animate) {
      // At this speed nobody can be watched walking away.
      for (const actor of this.#actors.values()) {
        if (!present.has(actor.id)) this.#actors.delete(actor.id);
      }
      this.#floaters = [];
    }

    this.#staff = simulation.staff;
    this.#busy = simulation.servers.map((customer) => customer !== null);
    this.#soldOut = simulation.stock === 0;
  }

  /**
   * @param {number} dt      seconds since the previous frame
   * @param {object} view
   * @param {number} view.clock   simulated time on display, for patience and service progress
   * @param {number} view.dayHour hours since opening, for the color of the sky
   * @param {number} [view.pace]  how many times faster than normal the day is playing
   * @param {boolean} [view.closed] the doors have closed
   */
  draw(dt, { clock, dayHour, pace = 1, closed = false }) {
    const layout = this.#layout;
    if (!layout) return;
    this.#time += dt * Math.max(pace, 0.6);
    const context = this.#context;
    context.clearRect(0, 0, layout.width, layout.height);

    const raining = this.#weather === 'rain';
    // The scenery keeps its own time: it does not hurry when the day is sped up.
    this.#life.update(dt, layout, { busy: closed ? 0 : this.#busy.filter(Boolean).length, raining });

    this.#drawSky(dayHour);
    this.#drawStreet();
    this.#life.drawTraffic(context, layout, this.#colors);
    this.#drawStallBack(dayHour);
    this.#drawStaff();
    this.#drawCounter();
    this.#drawRoof(closed);
    this.#life.drawSmoke(context, layout);
    this.#life.drawLights(context, layout, this.#colors, dayHour >= LIGHTS_ON);
    this.#drawStools();
    this.#life.drawCat(context, layout, this.#colors);
    this.#moveActors(dt, pace);
    // Those further back are drawn first, so nearer figures overlap them.
    const actors = [...this.#actors.values()].sort((a, b) => a.y - b.y);
    for (const actor of actors) this.#drawCustomer(actor, clock);
    this.#drawFloaters(dt * pace);
    if (raining) this.#life.drawRain(context, layout);
  }

  // --- Figures ----------------------------------------------------------------

  #spawn(customer) {
    const { entrance, ground } = this.#layout;
    const { shirts, skins } = this.#colors;
    const actor = {
      id: customer.id,
      customer,
      x: entrance,
      y: ground,
      targetX: entrance,
      targetY: ground,
      state: STATE.QUEUE,
      mark: null,
      hesitate: 0,
      shirt: shirts[customer.id % shirts.length],
      skin: skins[(customer.id * 7) % skins.length],
      headwear: 'hair',
    };
    // One customer in six is an ojek driver between orders; about a third wear a jilbab.
    const look = (customer.id * 5) % 12;
    if (look < 2) {
      actor.headwear = 'helmet';
      actor.shirt = this.#colors.ojol;
    } else if (look < 6) {
      actor.headwear = 'jilbab';
      actor.headColor = shirts[(customer.id + 2) % shirts.length];
    }
    this.#actors.set(customer.id, actor);
    return actor;
  }

  /** A waiting customer gets up and walks back out the way they came. */
  #leaveUnserved(customer, state) {
    const actor = this.#actors.get(customer.id);
    if (!actor) return;
    const { entrance, ground, unit } = this.#layout;
    actor.state = state;
    actor.targetX = entrance;
    actor.targetY = ground + unit * 1.6;
  }

  #float(text, x, y, color) {
    // The same word again on the same spot would only smear the first one.
    const { unit } = this.#layout;
    const repeated = this.#floaters.some(
      (floater) => floater.text === text && floater.age < 0.5 && Math.abs(floater.x - x) < unit * 6,
    );
    if (repeated) return;
    if (this.#floaters.length >= MAX_FLOATERS) this.#floaters.shift();
    this.#floaters.push({ text, x, y, color, age: 0 });
  }

  #moveActors(dt, pace) {
    const { width, unit } = this.#layout;
    // Exponential approach: equally smooth at 60 Hz and 120 Hz, and quicker
    // when the day is played faster.
    const glide = 1 - Math.exp(-dt / (GLIDE_SECONDS / pace));
    // The angry leave in a hurry.
    const hurry = 1 - Math.exp(-dt / (GLIDE_SECONDS / pace / 1.8));

    for (const actor of this.#actors.values()) {
      const rate = actor.state === STATE.ANGRY ? hurry : glide;
      // Leaving figures walk at a steadier pace than the glide alone gives.
      const leaving = actor.state === STATE.HAPPY || actor.state === STATE.ANGRY || actor.state === STATE.SAD;
      if (leaving) {
        const direction = Math.sign(actor.targetX - actor.x);
        actor.x += direction * unit * 22 * pace * (actor.state === STATE.ANGRY ? 1.5 : 1) * dt;
        actor.y += (actor.targetY - actor.y) * rate;
        if (actor.x > width + unit * 2.5 || actor.x < -unit * 2.5) this.#actors.delete(actor.id);
        continue;
      }
      actor.x += (actor.targetX - actor.x) * rate;
      actor.y += (actor.targetY - actor.y) * rate;

      if (actor.state === STATE.TURNING && Math.abs(actor.targetX - actor.x) < unit) {
        actor.hesitate -= dt * pace;
        if (actor.hesitate <= 0) this.#leaveUnserved(actor.customer, STATE.SAD);
      }
    }
  }

  #drawCustomer(actor, clock) {
    const { unit, ground } = this.#layout;
    const context = this.#context;
    const { customer, state } = actor;
    const moving = Math.abs(actor.targetX - actor.x) + Math.abs(actor.targetY - actor.y) > 1.5;
    const leaving = state === STATE.HAPPY || state === STATE.ANGRY || state === STATE.SAD;
    const walking = moving || leaving;
    const seated = state === STATE.QUEUE && !moving;
    const facing = leaving ? Math.sign(actor.targetX - actor.x) || 1 : 1;

    // A soft shadow under whoever is on their feet.
    if (!seated) {
      context.fillStyle = 'rgb(42 27 18 / 0.14)';
      context.beginPath();
      context.ellipse(actor.x, Math.max(actor.y, ground) + 1.5, unit * 0.95, unit * 0.28, 0, 0, TAU);
      context.fill();
    }

    let mood = 'calm';
    if (state === STATE.HAPPY) mood = 'happy';
    else if (state === STATE.ANGRY) mood = 'angry';
    else if (state === STATE.SAD || state === STATE.TURNING) mood = 'sad';

    this.#drawPerson(actor.x, actor.y, {
      shirt: actor.shirt,
      skin: actor.skin,
      headwear: actor.headwear,
      headColor: actor.headColor,
      phase: actor.id * 1.7,
      walking,
      seated,
      facing,
      mood,
      bag: state === STATE.HAPPY,
    });

    const headY = actor.y - unit * (seated ? 3.35 : 3.85);
    if (seated) {
      // The patience bar: full when they sat down, empty at the moment they will give up.
      const waited = clock - customer.arrivalTime;
      const left = Number.isFinite(customer.patience) ? clamp(1 - waited / customer.patience, 0, 1) : 1;
      const barWidth = unit * 2.3;
      const x = actor.x - barWidth / 2;
      const y = headY - unit * 1.7;
      context.fillStyle = this.#colors.surface;
      context.strokeStyle = this.#colors.ink;
      context.lineWidth = 1.2;
      this.#roundRect(x, y, barWidth, 4.5, 2);
      context.fill();
      context.stroke();
      let color = this.#colors.served;
      if (left < 0.25) color = this.#colors.sambal;
      else if (left < 0.55) color = this.#colors.kunyit;
      context.fillStyle = color;
      this.#roundRect(x + 0.8, y + 0.8, Math.max((barWidth - 1.6) * left, 0), 2.9, 1.4);
      context.fill();
    } else if (state === STATE.SERVICE && !moving) {
      // The service ring closes exactly when this customer's service ends.
      const span = customer.serviceEnd - customer.serviceStart;
      const done = span > 0 ? clamp((clock - customer.serviceStart) / span, 0, 1) : 1;
      context.strokeStyle = this.#colors.kunyit;
      context.lineWidth = 2.6;
      context.lineCap = 'round';
      context.beginPath();
      context.arc(actor.x, headY, unit * 1.25, -Math.PI / 2, -Math.PI / 2 + done * TAU);
      context.stroke();
    }

    if (state === STATE.ANGRY) this.#drawMark(actor.x, headY - unit * 1.9, '!', this.#colors.reneged);
    else if (state === STATE.TURNING || (state === STATE.SAD && actor.mark)) {
      const color = actor.mark === MARK.FULL ? this.#colors.balked : this.#colors.soldOut;
      this.#drawMark(actor.x, headY - unit * 1.9, actor.mark === MARK.FULL ? '×' : '', color);
    }
  }

  /** A small person: round head, a body in a colored shirt, two legs. `y` is where the feet are. */
  #drawPerson(x, y, { shirt, skin, phase = 0, walking = false, seated = false, facing = 1, mood = 'calm', bag = false, apron = false, headwear = 'hair', headColor }) {
    const { unit } = this.#layout;
    const context = this.#context;
    const swing = walking ? Math.sin(this.#time * 13 + phase) : 0;
    const bob = walking ? Math.abs(Math.sin(this.#time * 13 + phase)) * unit * 0.14 : 0;
    const hipY = y - unit * (seated ? 0.95 : 1.15);
    const bodyTop = hipY - unit * 1.95 - bob;
    const headY = bodyTop - unit * 0.72;

    context.save();
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = this.#colors.ink;

    // Legs
    context.lineWidth = unit * 0.42;
    context.beginPath();
    if (seated) {
      context.moveTo(x - unit * 0.3, hipY);
      context.lineTo(x + unit * 0.55, hipY + unit * 0.1);
      context.lineTo(x + unit * 0.55, y);
      context.moveTo(x + unit * 0.3, hipY);
      context.lineTo(x + unit * 1, hipY + unit * 0.1);
      context.lineTo(x + unit * 1, y);
    } else {
      context.moveTo(x - unit * 0.35, hipY);
      context.lineTo(x - unit * 0.35 + swing * unit * 0.55, y);
      context.moveTo(x + unit * 0.35, hipY);
      context.lineTo(x + unit * 0.35 - swing * unit * 0.55, y);
    }
    context.stroke();

    // Body
    context.lineWidth = 1.6;
    context.fillStyle = shirt;
    this.#roundRect(x - unit * 0.9, bodyTop, unit * 1.8, unit * 2.1, [unit * 0.8, unit * 0.8, unit * 0.3, unit * 0.3]);
    context.fill();
    context.stroke();
    if (apron) {
      context.fillStyle = this.#colors.krem;
      this.#roundRect(x - unit * 0.55, bodyTop + unit * 0.75, unit * 1.1, unit * 1.35, unit * 0.25);
      context.fill();
      context.stroke();
    }

    // A plastic bag of food to take home
    if (bag) {
      const bagX = x + facing * unit * 1.05;
      const bagY = hipY - unit * 0.35;
      context.beginPath();
      context.arc(bagX, bagY - unit * 0.1, unit * 0.32, Math.PI, 0);
      context.stroke();
      context.fillStyle = this.#colors.krem;
      context.beginPath();
      context.moveTo(bagX - unit * 0.42, bagY - unit * 0.1);
      context.lineTo(bagX + unit * 0.42, bagY - unit * 0.1);
      context.lineTo(bagX + unit * 0.55, bagY + unit * 0.85);
      context.lineTo(bagX - unit * 0.55, bagY + unit * 0.85);
      context.closePath();
      context.fill();
      context.stroke();
    }

    // Head
    if (headwear === 'jilbab') {
      // The scarf frames the face and falls over the shoulders.
      context.fillStyle = headColor;
      context.beginPath();
      context.arc(x, headY, unit * 1.02, Math.PI * 0.95, Math.PI * 0.05);
      context.lineTo(x + unit * 0.95, bodyTop + unit * 0.75);
      context.lineTo(x - unit * 0.95, bodyTop + unit * 0.75);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = skin;
      context.beginPath();
      context.ellipse(x, headY + unit * 0.08, unit * 0.6, unit * 0.66, 0, 0, TAU);
      context.fill();
      context.stroke();
    } else {
      context.fillStyle = skin;
      context.beginPath();
      context.arc(x, headY, unit * 0.82, 0, TAU);
      context.fill();
      context.stroke();
      if (headwear === 'peci') {
        context.fillStyle = this.#colors.ink;
        this.#roundRect(x - unit * 0.74, headY - unit * 1.1, unit * 1.48, unit * 0.66, [unit * 0.3, unit * 0.3, 0, 0]);
        context.fill();
      } else if (headwear === 'helmet') {
        context.fillStyle = this.#colors.ojol;
        context.beginPath();
        context.arc(x, headY - unit * 0.06, unit * 0.96, Math.PI, 0);
        context.lineTo(x + unit * 0.96, headY + unit * 0.08);
        context.lineTo(x - unit * 0.96, headY + unit * 0.08);
        context.closePath();
        context.fill();
        context.stroke();
      } else {
        // Hair
        context.fillStyle = this.#colors.ink;
        context.beginPath();
        context.arc(x, headY - unit * 0.12, unit * 0.82, Math.PI * 1.08, Math.PI * 1.92);
        context.closePath();
        context.fill();
      }
    }

    // Face
    context.fillStyle = this.#colors.ink;
    const eyeX = unit * 0.3;
    const gaze = facing * unit * 0.1;
    for (const side of [-1, 1]) {
      context.beginPath();
      context.arc(x + side * eyeX + gaze, headY + unit * 0.05, Math.max(unit * 0.11, 0.9), 0, TAU);
      context.fill();
    }
    context.lineWidth = 1.2;
    context.beginPath();
    if (mood === 'happy') {
      context.arc(x + gaze, headY + unit * 0.25, unit * 0.26, 0.15 * Math.PI, 0.85 * Math.PI);
    } else if (mood === 'angry' || mood === 'sad') {
      context.arc(x + gaze, headY + unit * 0.62, unit * 0.24, 1.2 * Math.PI, 1.8 * Math.PI);
    }
    context.stroke();
    if (mood === 'angry') {
      context.beginPath();
      context.moveTo(x - eyeX - unit * 0.2 + gaze, headY - unit * 0.28);
      context.lineTo(x - eyeX + unit * 0.16 + gaze, headY - unit * 0.12);
      context.moveTo(x + eyeX + unit * 0.2 + gaze, headY - unit * 0.28);
      context.lineTo(x + eyeX - unit * 0.16 + gaze, headY - unit * 0.12);
      context.stroke();
    }
    context.restore();
  }

  /** A small badge over a head: why this customer is leaving. */
  #drawMark(x, y, glyph, color) {
    const { unit } = this.#layout;
    const context = this.#context;
    const wobble = Math.sin(this.#time * 18) * 0.8;
    context.save();
    context.fillStyle = color;
    context.strokeStyle = this.#colors.ink;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(x + wobble, y, unit * 0.85, 0, TAU);
    context.fill();
    context.stroke();
    if (glyph === '') {
      // Nothing left: an empty plate with a line through it.
      context.strokeStyle = '#fff';
      context.lineWidth = 1.6;
      context.beginPath();
      context.arc(x + wobble, y, unit * 0.42, 0, TAU);
      context.moveTo(x + wobble - unit * 0.42, y + unit * 0.42);
      context.lineTo(x + wobble + unit * 0.42, y - unit * 0.42);
      context.stroke();
    } else {
      context.fillStyle = glyph === '×' ? this.#colors.ink : '#fff';
      context.font = `800 ${Math.round(unit * 1.3)}px ${this.#colors.display}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(glyph, x + wobble, y + unit * 0.08);
    }
    context.restore();
  }

  // --- The kampung, the street, and the warung --------------------------------

  #drawSky(dayHour) {
    const { width, height, ground, unit } = this.#layout;
    const context = this.#context;
    const [top, bottom] = skyAt(dayHour);
    const night = dayHour > 12;
    const sky = context.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, rgb(top));
    sky.addColorStop(1, rgb(bottom));
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);

    // The sun crosses the sky during opening hours, and the moon takes over after closing.
    const progress = clamp(dayHour / 12, 0, 1);
    const sunX = width * (0.07 + 0.86 * progress);
    const sunY = ground * 0.78 - Math.sin(progress * Math.PI) * ground * 0.6;
    if (night) {
      context.fillStyle = rgb(hexToRgb('#fff4dc'), 0.92);
      context.beginPath();
      context.arc(width * 0.46, ground * 0.2, unit * 1.7, 0, TAU);
      context.fill();
      context.fillStyle = rgb(top);
      context.beginPath();
      context.arc(width * 0.46 + unit * 0.75, ground * 0.2 - unit * 0.3, unit * 1.5, 0, TAU);
      context.fill();
    } else {
      const glow = context.createRadialGradient(sunX, sunY, unit, sunX, sunY, unit * 6);
      glow.addColorStop(0, 'rgb(255 244 200 / 0.75)');
      glow.addColorStop(1, 'rgb(255 244 200 / 0)');
      context.fillStyle = glow;
      context.fillRect(sunX - unit * 6, sunY - unit * 6, unit * 12, unit * 12);
      context.fillStyle = '#ffd866';
      context.beginPath();
      context.arc(sunX, sunY, unit * 1.9, 0, TAU);
      context.fill();
    }

    // Stars come out as the sky darkens, and twinkle.
    const starlight = clamp((dayHour - 11.2) / 1.5, 0, 1) * (dayHour < 14.2 ? 1 : 0);
    if (starlight > 0) {
      context.fillStyle = '#fff';
      for (let i = 0; i < 16; i++) {
        const x = ((i * 0.618 + 0.11) % 1) * width;
        const y = ((i * 0.377 + 0.05) % 1) * ground * 0.55;
        context.globalAlpha = starlight * (0.55 + 0.45 * Math.sin(this.#time * 2.2 + i * 2.1));
        context.beginPath();
        context.arc(x, y, i % 4 === 0 ? 1.6 : 1, 0, TAU);
        context.fill();
      }
      context.globalAlpha = 1;
    }

    // Clouds drifting slowly to the right.
    context.fillStyle = rgb(mix(top, [255, 255, 255], 0.75), night ? 0.25 : 0.85);
    for (const [offset, level, size] of [
      [0.12, 0.16, 1],
      [0.55, 0.1, 1.25],
      [0.85, 0.24, 0.8],
    ]) {
      const x = ((offset * width + this.#time * unit * 0.9) % (width + unit * 16)) - unit * 8;
      const y = ground * level;
      context.beginPath();
      context.ellipse(x, y, unit * 3.2 * size, unit * 1.1 * size, 0, 0, TAU);
      context.ellipse(x + unit * 2.2 * size, y + unit * 0.3, unit * 2.4 * size, unit * 0.9 * size, 0, 0, TAU);
      context.ellipse(x - unit * 2 * size, y + unit * 0.4, unit * 2 * size, unit * 0.8 * size, 0, 0, TAU);
      context.fill();
    }

    // Two mountains on the horizon, the way every landscape is drawn at
    // school here. In the morning the sun comes up from behind them.
    context.fillStyle = rgb(mix(bottom, [62, 104, 112], night ? 0.6 : 0.42));
    for (const [peak, rise, half] of [
      [0.1, 0.5, 0.17],
      [0.26, 0.38, 0.15],
    ]) {
      const x = width * peak;
      const y = ground * (1 - rise);
      context.beginPath();
      context.moveTo(x - width * half, ground);
      context.quadraticCurveTo(x - width * half * 0.25, y + ground * rise * 0.12, x, y);
      context.quadraticCurveTo(x + width * half * 0.25, y + ground * rise * 0.12, x + width * half, ground);
      context.closePath();
      context.fill();
    }

    // The kampung: tiled roofs, and the dome and minaret of its mosque.
    const wall = rgb(mix(bottom, night ? [42, 27, 18] : [255, 248, 230], night ? 0.45 : 0.3));
    const tiles = rgb(mix(bottom, [190, 96, 52], night ? 0.3 : 0.55));
    let x = -unit * 2;
    for (let i = 0; x < width; i++) {
      const houseWidth = unit * (5 + ((i * 37) % 5));
      const houseHeight = unit * (2.6 + ((i * 53) % 4) * 0.7);
      if (i === 3) {
        // The mosque
        const center = x + houseWidth / 2;
        context.fillStyle = wall;
        context.fillRect(x, ground - houseHeight, houseWidth, houseHeight);
        context.fillRect(x + houseWidth + unit * 0.4, ground - houseHeight - unit * 4, unit * 0.9, houseHeight + unit * 4);
        context.fillStyle = tiles;
        context.beginPath();
        context.arc(center, ground - houseHeight, houseWidth * 0.3, Math.PI, 0);
        context.fill();
        context.beginPath();
        context.arc(x + houseWidth + unit * 0.85, ground - houseHeight - unit * 4, unit * 0.6, Math.PI, 0);
        context.fill();
        context.fillRect(center - 1, ground - houseHeight - houseWidth * 0.3 - unit * 1.1, 2, unit * 1.1);
      } else {
        context.fillStyle = wall;
        context.fillRect(x, ground - houseHeight, houseWidth, houseHeight);
        // Toward evening the windows light up, one house after another.
        if (dayHour >= LIGHTS_ON + (i % 3) * 0.4) {
          context.fillStyle = 'rgb(255 214 120 / 0.9)';
          for (let window = 0; window < 1 + (i % 2); window++) {
            context.fillRect(x + unit * (1 + window * 2.2), ground - houseHeight + unit * 0.7, unit * 1.1, unit * 1.1);
          }
        }
        context.fillStyle = tiles;
        context.beginPath();
        context.moveTo(x - unit * 0.7, ground - houseHeight);
        context.lineTo(x + houseWidth * 0.22, ground - houseHeight - unit * 1.9);
        context.lineTo(x + houseWidth * 0.78, ground - houseHeight - unit * 1.9);
        context.lineTo(x + houseWidth + unit * 0.7, ground - houseHeight);
        context.closePath();
        context.fill();
      }
      x += houseWidth + unit * (1.4 + ((i * 29) % 3));
    }
  }

  #drawStreet() {
    const { width, height, ground, unit, stallX, stallWidth, roof } = this.#layout;
    const context = this.#context;
    context.fillStyle = this.#colors.ground;
    context.fillRect(0, ground, width, height - ground);
    context.strokeStyle = this.#colors.ink;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, ground);
    context.lineTo(width, ground);
    context.stroke();
    // Paving joints
    context.strokeStyle = 'rgb(42 27 18 / 0.16)';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = unit * 3; x < width; x += unit * 7) {
      context.moveTo(x, ground + 2);
      context.lineTo(x - unit * 1.4, height);
    }
    context.stroke();

    // A power pole, with the wires that sag from it across the street.
    const poleX = width * 0.36;
    const poleTop = ground - unit * 15;
    context.strokeStyle = 'rgb(42 27 18 / 0.7)';
    context.lineWidth = 1.2;
    for (const [dy, sag] of [
      [0.6, 2.4],
      [1.5, 3.2],
    ]) {
      context.beginPath();
      context.moveTo(-unit, poleTop + unit * (dy + 1.5));
      context.quadraticCurveTo(poleX * 0.5, poleTop + unit * (dy + sag), poleX, poleTop + unit * dy);
      context.quadraticCurveTo((poleX + stallX) / 2 + stallWidth * 0.2, poleTop + unit * (dy + sag + 1), stallX + stallWidth * 0.5, roof - unit * 2.4);
      context.stroke();
    }
    context.fillStyle = this.#colors.wood;
    context.strokeStyle = this.#colors.ink;
    context.lineWidth = 1.6;
    context.fillRect(poleX - unit * 0.28, poleTop, unit * 0.56, ground - poleTop);
    context.strokeRect(poleX - unit * 0.28, poleTop, unit * 0.56, ground - poleTop);
    context.fillRect(poleX - unit * 1.6, poleTop + unit * 0.4, unit * 3.2, unit * 0.42);
    context.strokeRect(poleX - unit * 1.6, poleTop + unit * 0.4, unit * 3.2, unit * 0.42);

    // A coconut palm at the roadside, its fronds swaying a little.
    const palmX = width * 0.07;
    const crownX = palmX + unit * 1.1;
    const crownY = ground - unit * 10.5;
    const sway = Math.sin(this.#time * 0.9) * 0.05;
    context.strokeStyle = this.#colors.ink;
    context.lineCap = 'round';
    context.lineWidth = unit * 1.05;
    context.beginPath();
    context.moveTo(palmX, ground);
    context.quadraticCurveTo(palmX - unit * 0.6, ground - unit * 5.5, crownX, crownY);
    context.stroke();
    context.strokeStyle = this.#colors.wood;
    context.lineWidth = unit * 0.7;
    context.stroke();
    context.lineWidth = 1.6;
    context.strokeStyle = this.#colors.ink;
    for (const [angle, length, shade] of [
      [-2.75, 5.2, 0],
      [-2.2, 5.6, 1],
      [-1.55, 4.8, 0],
      [-0.95, 5.6, 1],
      [-0.4, 5.2, 0],
      [0.25, 4.4, 1],
      [2.9, 4.4, 1],
    ]) {
      const a = angle + sway;
      const midX = crownX + (Math.cos(a) * length * unit) / 2;
      const midY = crownY + (Math.sin(a) * length * unit) / 2 + unit * 0.5;
      context.fillStyle = shade ? this.#colors.daun : this.#colors.daunMuda;
      context.beginPath();
      context.ellipse(midX, midY, (length * unit) / 2, unit * 0.62, a + 0.18 * Math.sign(Math.cos(a)), 0, TAU);
      context.fill();
      context.stroke();
    }
    context.fillStyle = this.#colors.wood;
    for (const dx of [-0.45, 0.45]) {
      context.beginPath();
      context.arc(crownX + dx * unit, crownY + unit * 0.7, unit * 0.48, 0, TAU);
      context.fill();
      context.stroke();
    }
    context.lineCap = 'butt';
  }

  /** The inside of the warung: a cream wall, a shelf of jars, the lamp, and the two posts. */
  #drawStallBack(dayHour) {
    const { stallX, stallWidth, roof, ground, unit } = this.#layout;
    const context = this.#context;
    context.fillStyle = this.#colors.krem;
    context.strokeStyle = this.#colors.ink;
    context.lineWidth = 2;
    context.fillRect(stallX, roof, stallWidth, ground - roof);
    context.strokeRect(stallX, roof, stallWidth, ground - roof);

    // A shelf of jars and bottles
    const shelfY = roof + unit * 4.6;
    context.beginPath();
    context.moveTo(stallX + unit, shelfY);
    context.lineTo(stallX + stallWidth - unit, shelfY);
    context.stroke();
    const jars = [this.#colors.kunyit, this.#colors.sambal, this.#colors.daun, this.#colors.woodLight];
    for (let i = 0; i * unit * 2.2 + unit * 3.4 < stallWidth; i++) {
      context.fillStyle = jars[i % jars.length];
      this.#roundRect(stallX + unit * 1.6 + i * unit * 2.2, shelfY - unit * 1.3, unit * 1.2, unit * 1.3, unit * 0.3);
      context.fill();
      context.stroke();
    }

    // The lamp comes on toward evening.
    const lit = dayHour >= LIGHTS_ON;
    const lampX = stallX + stallWidth * 0.5;
    const lampY = roof + unit * 3.9;
    if (lit) {
      const glow = context.createRadialGradient(lampX, lampY, 1, lampX, lampY, unit * 9);
      glow.addColorStop(0, 'rgb(255 214 120 / 0.6)');
      glow.addColorStop(1, 'rgb(255 214 120 / 0)');
      context.fillStyle = glow;
      context.fillRect(lampX - unit * 9, lampY - unit * 9, unit * 18, unit * 18);
    }
    context.fillStyle = lit ? '#ffe08a' : this.#colors.paper;
    context.beginPath();
    context.arc(lampX, lampY, unit * 0.55, 0, TAU);
    context.fill();
    context.stroke();

    // The posts, painted the blue-green of every warung front.
    context.fillStyle = this.#colors.toska;
    for (const x of [stallX - unit * 0.5, stallX + stallWidth - unit * 0.5]) {
      context.fillRect(x, roof, unit, ground - roof);
      context.strokeRect(x, roof, unit, ground - roof);
    }
  }

  /** The pegawai on duty, behind the counter. A busy one bobs as they work. */
  #drawStaff() {
    const { booths, counterTop, unit } = this.#layout;
    const busyCount = this.#busy.filter(Boolean).length;
    // Those at their post: everyone serving, plus idle pegawai up to the number on duty.
    let idleLeft = Math.max(this.#staff - busyCount, 0);
    booths.forEach((x, i) => {
      const busy = this.#busy[i];
      if (!busy && idleLeft <= 0) return;
      if (!busy) idleLeft--;
      const lift = busy ? Math.abs(Math.sin(this.#time * 9 + i * 2)) * unit * 0.3 : 0;
      // One in a jilbab, the next in a peci: no chef's hats in a warung.
      this.#drawPerson(x, counterTop + unit * 1.15 - lift, {
        shirt: i % 2 === 0 ? this.#colors.toska : this.#colors.daun,
        skin: this.#colors.skins[i % this.#colors.skins.length],
        apron: true,
        headwear: i % 2 === 0 ? 'jilbab' : 'peci',
        headColor: this.#colors.bata,
        mood: 'happy',
      });
    });
  }

  /** The counter, with the glass case of dishes and the tin of kerupuk on it. */
  #drawCounter() {
    const { stallX, stallWidth, counterTop, ground, unit, caseX, caseWidth } = this.#layout;
    const context = this.#context;
    const bodyTop = counterTop + unit * 0.9;

    // The front, painted blue-green with a yellow band.
    context.strokeStyle = this.#colors.ink;
    context.lineWidth = 2;
    context.fillStyle = this.#colors.toska;
    context.fillRect(stallX - unit * 0.6, bodyTop, stallWidth + unit * 1.2, ground - bodyTop);
    context.fillStyle = this.#colors.kunyit;
    context.fillRect(stallX - unit * 0.6, bodyTop + unit * 0.8, stallWidth + unit * 1.2, unit * 0.6);
    context.strokeRect(stallX - unit * 0.6, bodyTop, stallWidth + unit * 1.2, ground - bodyTop);
    context.strokeStyle = 'rgb(42 27 18 / 0.28)';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = stallX + unit * 2.4; x < stallX + stallWidth; x += unit * 3) {
      context.moveTo(x, bodyTop + unit * 1.5);
      context.lineTo(x, ground);
    }
    context.stroke();

    // The counter top
    context.strokeStyle = this.#colors.ink;
    context.lineWidth = 2;
    context.fillStyle = this.#colors.woodLight;
    this.#roundRect(stallX - unit * 1.1, counterTop, stallWidth + unit * 2.2, unit * 1.1, unit * 0.3);
    context.fill();
    context.stroke();

    // The glass case: two shelves of dishes, bare once everything is sold.
    const glassWidth = caseWidth - unit * 1.2;
    const glassHeight = unit * 3.5;
    const glassTop = counterTop - glassHeight;
    context.fillStyle = 'rgb(210 236 245 / 0.82)';
    context.fillRect(caseX, glassTop, glassWidth, glassHeight);
    context.strokeRect(caseX, glassTop, glassWidth, glassHeight);
    context.fillStyle = this.#colors.toska;
    context.fillRect(caseX, glassTop, glassWidth, unit * 0.45);
    context.strokeRect(caseX, glassTop, glassWidth, unit * 0.45);
    const dishes = [this.#colors.kunyit, this.#colors.sambal, this.#colors.daun, this.#colors.woodLight, this.#colors.bata];
    for (let shelf = 0; shelf < 2; shelf++) {
      const shelfY = glassTop + unit * (1.9 + shelf * 1.55);
      context.lineWidth = 1.4;
      context.beginPath();
      context.moveTo(caseX, shelfY);
      context.lineTo(caseX + glassWidth, shelfY);
      context.stroke();
      if (this.#soldOut) continue;
      for (let i = 0; (i + 1) * unit * 1.25 < glassWidth; i++) {
        context.fillStyle = dishes[(i + shelf * 2) % dishes.length];
        context.beginPath();
        context.arc(caseX + unit * (0.8 + i * 1.25), shelfY - unit * 0.12, unit * 0.5, Math.PI, 0);
        context.closePath();
        context.fill();
        context.stroke();
      }
    }

    // The tin of kerupuk, red lid and all.
    const tinX = caseX + glassWidth - unit * 1.75;
    const tinTop = glassTop - unit * 1.9;
    context.lineWidth = 1.6;
    context.fillStyle = '#f6e9bd';
    context.fillRect(tinX, tinTop, unit * 1.5, unit * 1.9);
    context.strokeRect(tinX, tinTop, unit * 1.5, unit * 1.9);
    context.fillStyle = this.#colors.sambal;
    context.fillRect(tinX - unit * 0.1, tinTop - unit * 0.35, unit * 1.7, unit * 0.4);
    context.strokeRect(tinX - unit * 0.1, tinTop - unit * 0.35, unit * 1.7, unit * 0.4);
  }

  /**
   * The roof of clay tiles, the cloth banner with the menu under its eave,
   * what hangs from the eave, and the "HABIS" or "TUTUP" board.
   */
  #drawRoof(closed) {
    const { stallX, stallWidth, roof, unit } = this.#layout;
    const context = this.#context;
    const left = stallX - unit * 2.4;
    const right = stallX + stallWidth + unit * 2.4;
    const eave = roof + unit * 0.2;
    const ridge = roof - unit * 3.1;
    const inset = unit * 2.8;

    // Clay tiles (genteng), in three courses.
    context.strokeStyle = this.#colors.ink;
    context.lineWidth = 2;
    context.fillStyle = this.#colors.genteng;
    context.beginPath();
    context.moveTo(left, eave);
    context.lineTo(left + inset, ridge);
    context.lineTo(right - inset, ridge);
    context.lineTo(right, eave);
    context.closePath();
    context.fill();
    context.stroke();
    context.strokeStyle = this.#colors.gentengDeep;
    context.lineWidth = 1.4;
    for (const t of [1 / 3, 2 / 3]) {
      const y = ridge + (eave - ridge) * t;
      context.beginPath();
      context.moveTo(left + inset * (1 - t), y);
      context.lineTo(right - inset * (1 - t), y);
      context.stroke();
    }
    // The rounded ends of the tiles along the eave.
    context.strokeStyle = this.#colors.ink;
    context.fillStyle = this.#colors.gentengDeep;
    const tile = (right - left) / Math.max(Math.round((right - left) / (unit * 1.5)), 4);
    for (let x = left; x < right - 1; x += tile) {
      context.beginPath();
      context.arc(x + tile / 2, eave, tile / 2, 0, Math.PI);
      context.closePath();
      context.fill();
      context.stroke();
    }

    // The cloth banner (spanduk) with the warung's name, moving a little in the wind.
    const bannerLeft = stallX + unit * 1;
    const bannerRight = stallX + stallWidth - unit * 1;
    const bannerTop = roof + unit * 1.25;
    const bannerHeight = unit * 2.1;
    const ripple = Math.sin(this.#time * 1.7) * unit * 0.14;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(bannerLeft, bannerTop);
    context.lineTo(stallX, eave + unit * 0.4);
    context.moveTo(bannerRight, bannerTop);
    context.lineTo(stallX + stallWidth, eave + unit * 0.4);
    context.stroke();
    context.lineWidth = 1.6;
    context.fillStyle = this.#colors.surface;
    context.beginPath();
    context.moveTo(bannerLeft, bannerTop);
    context.lineTo(bannerRight, bannerTop);
    context.lineTo(bannerRight, bannerTop + bannerHeight);
    context.quadraticCurveTo((bannerLeft + bannerRight) / 2, bannerTop + bannerHeight + ripple, bannerLeft, bannerTop + bannerHeight);
    context.closePath();
    context.fill();
    context.stroke();
    const name = 'WARUNG PAK ERLANGGA';
    let size = unit * 1.3;
    context.font = `800 ${size}px ${this.#colors.display}`;
    const fits = (bannerRight - bannerLeft - unit * 1.2) / context.measureText(name).width;
    if (fits < 1) size *= fits;
    context.font = `800 ${size}px ${this.#colors.display}`;
    context.fillStyle = this.#colors.bata;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, (bannerLeft + bannerRight) / 2, bannerTop + bannerHeight / 2 + unit * 0.08);

    // Strings of sachets hang from the eave on one side...
    const sachets = [this.#colors.sambal, this.#colors.kunyit, this.#colors.daun, this.#colors.krem];
    context.lineWidth = 1.2;
    for (let strip = 0; strip < 2; strip++) {
      const x = stallX + stallWidth + unit * (0.75 + strip * 1.05);
      const swing = Math.sin(this.#time * 1.3 + strip) * unit * 0.1;
      for (let i = 0; i < 4; i++) {
        context.fillStyle = sachets[(i + strip) % sachets.length];
        const y = eave + unit * (0.7 + i * 0.86);
        context.fillRect(x - unit * 0.36 + swing * (i / 3), y, unit * 0.72, unit * 0.78);
        context.strokeRect(x - unit * 0.36 + swing * (i / 3), y, unit * 0.72, unit * 0.78);
      }
    }
    // ...and a bunch of bananas on the other.
    const bananaX = stallX - unit * 1.4;
    const bananaY = eave + unit * 1.9;
    context.beginPath();
    context.moveTo(bananaX, eave + unit * 0.5);
    context.lineTo(bananaX, bananaY - unit * 0.8);
    context.stroke();
    context.fillStyle = this.#colors.kunyit;
    for (const lean of [-0.55, -0.2, 0.2, 0.55]) {
      context.beginPath();
      context.ellipse(bananaX + lean * unit * 0.9, bananaY, unit * 0.28, unit * 0.95, lean * 0.7, 0, TAU);
      context.fill();
      context.stroke();
    }

    const board = this.#soldOut ? 'HABIS' : closed ? 'TUTUP' : null;
    if (!board) return;
    const boardWidth = unit * 7.5;
    const boardHeight = unit * 2.6;
    context.save();
    context.translate(stallX + stallWidth * 0.36, bannerTop + bannerHeight + unit * 0.9);
    context.rotate(Math.sin(this.#time * 2.2) * 0.035);
    context.strokeStyle = this.#colors.ink;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(-boardWidth * 0.32, -unit * 0.9);
    context.lineTo(-boardWidth * 0.32, 0);
    context.moveTo(boardWidth * 0.32, -unit * 0.9);
    context.lineTo(boardWidth * 0.32, 0);
    context.stroke();
    context.lineWidth = 2;
    context.fillStyle = this.#soldOut ? this.#colors.sambal : this.#colors.ink;
    this.#roundRect(-boardWidth / 2, 0, boardWidth, boardHeight, unit * 0.4);
    context.fill();
    context.stroke();
    context.fillStyle = this.#colors.krem;
    context.font = `800 ${Math.round(unit * 1.75)}px ${this.#colors.display}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(board, 0, boardHeight / 2 + unit * 0.12);
    context.restore();
  }

  /**
   * One plastic stool per waiting seat, in the red, blue, and green they
   * always come in. The size of the waiting room is visible even when empty.
   */
  #drawStools() {
    const { stools, ground, unit } = this.#layout;
    const context = this.#context;
    const colors = [this.#colors.sambal, this.#colors.biru, this.#colors.daun];
    context.strokeStyle = this.#colors.ink;
    context.lineWidth = 1.6;
    stools.forEach((x, k) => {
      context.fillStyle = colors[k % colors.length];
      context.beginPath();
      context.moveTo(x - unit * 0.85, ground - unit * 1.3);
      context.lineTo(x + unit * 0.85, ground - unit * 1.3);
      context.lineTo(x + unit * 1.15, ground);
      context.lineTo(x - unit * 1.15, ground);
      context.closePath();
      context.fill();
      context.stroke();
      // The cut-out in the side of the stool
      context.fillStyle = 'rgb(42 27 18 / 0.28)';
      this.#roundRect(x - unit * 0.42, ground - unit * 0.72, unit * 0.84, unit * 0.5, unit * 0.2);
      context.fill();
    });
  }

  /** Short words that rise and fade: a sale at the counter, a customer lost. */
  #drawFloaters(dt) {
    const { unit } = this.#layout;
    const context = this.#context;
    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `800 ${Math.round(unit * 1.55)}px ${this.#colors.display}`;
    context.lineJoin = 'round';
    this.#floaters = this.#floaters.filter((floater) => {
      floater.age += dt / 1.1;
      if (floater.age >= 1) return false;
      const y = floater.y - floater.age * unit * 3.2;
      context.globalAlpha = floater.age < 0.7 ? 1 : 1 - (floater.age - 0.7) / 0.3;
      context.lineWidth = 3.5;
      context.strokeStyle = this.#colors.surface;
      context.strokeText(floater.text, floater.x, y);
      context.fillStyle = floater.color;
      context.fillText(floater.text, floater.x, y);
      return true;
    });
    context.restore();
  }

  #roundRect(x, y, width, height, radius) {
    const context = this.#context;
    context.beginPath();
    if (context.roundRect) context.roundRect(x, y, width, height, radius);
    else context.rect(x, y, width, height);
  }
}
