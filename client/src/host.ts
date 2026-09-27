import type { AppState, EditRequest, EditResult, FocusTarget, Mode } from '../../shared/types';
import { api } from './api';

/** The host adapter is ShowMe's boundary with an application. */
export interface HostAdapter {
  getContext(): Promise<AppState>;
  execute(edit: EditRequest): Promise<EditResult>;
  setMode(mode: Mode): Promise<AppState>;
  focus(target: FocusTarget | null): Promise<AppState>;
  onChange(listener: (state: AppState) => void): () => void;
}

export class InvoiceHostAdapter implements HostAdapter {
  private listeners = new Set<(state: AppState) => void>();
  private latest: AppState | null = null;
  async getContext() { const state = await api.state(); this.publish(state); return state; }
  async execute(edit: EditRequest) { const result = await api.edit(edit); this.publish(result.state); return result; }
  async setMode(mode: Mode) { const state = await api.mode(mode); this.publish(state); return state; }
  async focus(target: FocusTarget | null) { const state = await api.focus(target); this.publish(state); return state; }
  onChange(listener: (state: AppState) => void) {
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return () => this.listeners.delete(listener);
  }
  private publish(state: AppState) {
    this.latest = state;
    for (const listener of this.listeners) listener(state);
  }
}
