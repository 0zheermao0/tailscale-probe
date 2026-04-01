import type { NetworkSnapshot, ChangeEvent } from '../backend/types.js';

export interface AppState {
  snapshot: NetworkSnapshot | null;
  history: ChangeEvent[];
  connected: boolean;
}

type Listener = (state: AppState) => void;

class Store {
  private state: AppState = {
    snapshot: null,
    history: [],
    connected: false,
  };
  private listeners: Set<Listener> = new Set();

  get(): AppState {
    return this.state;
  }

  setSnapshot(snapshot: NetworkSnapshot | null): void {
    this.state = { ...this.state, snapshot };
    this.notify();
  }

  addChanges(events: ChangeEvent[]): void {
    const history = [...events, ...this.state.history].slice(0, 100);
    this.state = { ...this.state, history };
    this.notify();
  }

  setHistory(history: ChangeEvent[]): void {
    this.state = { ...this.state, history };
    this.notify();
  }

  setConnected(connected: boolean): void {
    this.state = { ...this.state, connected };
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const store = new Store();
