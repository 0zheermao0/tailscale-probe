import { NetworkSnapshot, ChangeEvent } from './types.js';

export class StateStore {
  private snapshot: NetworkSnapshot | null = null;
  private history: ChangeEvent[] = [];
  private maxHistory: number;

  constructor(maxHistory = 100) {
    this.maxHistory = maxHistory;
  }

  setSnapshot(snapshot: NetworkSnapshot): void {
    this.snapshot = snapshot;
  }

  addChange(event: ChangeEvent): void {
    this.history.unshift(event);
    if (this.history.length > this.maxHistory) {
      this.history.length = this.maxHistory;
    }
  }

  getSnapshot(): NetworkSnapshot | null {
    return this.snapshot;
  }

  getHistory(): ChangeEvent[] {
    return this.history;
  }

  toJSON(): { snapshot: NetworkSnapshot | null; history: ChangeEvent[] } {
    return {
      snapshot: this.snapshot,
      history: this.history,
    };
  }

  setMaxHistory(max: number): void {
    this.maxHistory = max;
  }
}
