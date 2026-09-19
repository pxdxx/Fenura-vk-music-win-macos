export class Bus {
  #handlers = new Map();

  on(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(handler);
    return () => this.#handlers.get(event).delete(handler);
  }

  emit(event, payload) {
    const set = this.#handlers.get(event);
    if (set) for (const handler of [...set]) handler(payload);
  }
}
