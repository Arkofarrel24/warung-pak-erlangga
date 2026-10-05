/**
 * Future event list (FEL): the events that have been scheduled but have not
 * happened yet. The simulation engine always takes the earliest one.
 *
 * Stored as a binary min-heap inside an array: the children of index i sit at
 * 2i + 1 and 2i + 2, and a parent is always earlier than its children, so the
 * earliest event is always at index 0. Insert and remove are both O(log n).
 *
 * Every event remembers its own position in the array (`index`). That makes
 * it an indexed heap: an event can be cancelled in O(log n) without searching
 * for it. Reneging needs this, because a customer's "runs out of patience"
 * event must disappear the moment that customer is called to a server.
 */
export class EventQueue {
  #heap = [];
  #nextSeq = 0;

  get size() {
    return this.#heap.length;
  }

  /**
   * Schedules a new event.
   *
   * `seq` is the scheduling order. When two events fall at the same time, the
   * one scheduled first is processed first. Without it the order would depend
   * on the shape of the heap, and results could differ from run to run.
   */
  schedule(time, type, data = null) {
    const event = { time, seq: this.#nextSeq++, type, data, index: this.#heap.length };
    this.#heap.push(event);
    this.#siftUp(event.index);
    return event;
  }

  /** The earliest event, without removing it. */
  peek() {
    return this.#heap[0];
  }

  /** Removes and returns the earliest event, or undefined when empty. */
  pop() {
    const earliest = this.#heap[0];
    if (earliest) this.#removeAt(0);
    return earliest;
  }

  /**
   * Removes an event that has not happened yet, so it never will.
   *
   * @param {object} event an event returned by schedule()
   * @returns {boolean} false when the event is no longer in the list (it has
   *   already happened or was already cancelled)
   */
  cancel(event) {
    if (!event || this.#heap[event.index] !== event) return false;
    this.#removeAt(event.index);
    return true;
  }

  /**
   * Takes out the event at `index`: the last event moves into the gap and is
   * then sifted in whichever direction restores the heap order.
   */
  #removeAt(index) {
    const heap = this.#heap;
    const removed = heap[index];
    const last = heap.pop();
    removed.index = -1;
    if (last === removed) return;

    this.#place(index, last);
    this.#siftUp(index);
    this.#siftDown(last.index);
  }

  #place(index, event) {
    this.#heap[index] = event;
    event.index = index;
  }

  #siftUp(index) {
    const heap = this.#heap;
    const event = heap[index];
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!isEarlier(event, heap[parent])) break;
      this.#place(index, heap[parent]);
      index = parent;
    }
    this.#place(index, event);
  }

  #siftDown(index) {
    const heap = this.#heap;
    const length = heap.length;
    const event = heap[index];
    for (;;) {
      const left = 2 * index + 1;
      const right = left + 1;
      let earliest = event;
      let earliestIndex = index;
      if (left < length && isEarlier(heap[left], earliest)) {
        earliest = heap[left];
        earliestIndex = left;
      }
      if (right < length && isEarlier(heap[right], earliest)) {
        earliest = heap[right];
        earliestIndex = right;
      }
      if (earliestIndex === index) break;
      this.#place(index, earliest);
      index = earliestIndex;
    }
    this.#place(index, event);
  }
}

function isEarlier(a, b) {
  return a.time < b.time || (a.time === b.time && a.seq < b.seq);
}
