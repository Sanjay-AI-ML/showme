import type { AppState, Customer, EditRequest, EditResult, FocusTarget, Mode, Product } from '../../shared/types';
import { createHostBridge } from '../../sdk/host-bridge';
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
  private bridge = createHostBridge<AppState, EditRequest, EditResult>({
    read: api.state,
    write: api.edit,
    stateOf: (result) => result.state,
    revisionOf: (state) => state.invoice.revision,
  });
  getContext() { return this.bridge.getContext(); }
  execute(edit: EditRequest) { return this.bridge.execute(edit); }
  addCustomer(customer: Omit<Customer, 'id'>) { return this.bridge.apply(() => api.addCustomer(customer), (result) => result.state); }
  addProduct(product: Omit<Product, 'id'>) { return this.bridge.apply(() => api.addProduct(product), (result) => result.state); }
  setMode(mode: Mode) { return this.bridge.apply(() => api.mode(mode), (state) => state); }
  focus(target: FocusTarget | null) { return this.bridge.apply(() => api.focus(target), (state) => state); }
  onChange(listener: (state: AppState) => void) { return this.bridge.onChange(listener); }
  reset() { this.bridge.reset(); }
}
