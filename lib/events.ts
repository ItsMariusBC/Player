// lib/events.ts
export type Listener<T> = (event: T) => void;

export interface Emitter<T> {
  emit(event: T): void;
  subscribe(listener: Listener<T>): () => void;
  clear(): void;
}

/**
 * Minimal synchronous event bus. Listeners added or removed during an emit
 * do not affect the current dispatch.
 */
export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<Listener<T>>();
  return {
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      listeners.clear();
    },
  };
}
