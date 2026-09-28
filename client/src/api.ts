import type { AppState, Customer, EditRequest, EditResult, FocusTarget, Mode, Product } from '../../shared/types';
import type { ProfileEdit, ProfileState } from '../../shared/profile';

async function request<T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  return data as T;
}

export const api = {
  auth: () => request<{ required: boolean; authenticated: boolean }>('/api/auth'),
  login: (code: string) => request<{ ok: true }>('/api/login', 'POST', { code }),
  logout: () => request<{ ok: true }>('/api/logout', 'POST', {}),
  exportAccount: () => request<Record<string, unknown>>('/api/account/export'),
  deleteAccount: () => request<{ ok: true }>('/api/account', 'DELETE'),
  state: () => request<AppState>('/api/state'),
  profileState: () => request<ProfileState>('/api/profile/state'),
  profileEdit: (edit: ProfileEdit) => request<{ state: ProfileState; applied: boolean }>('/api/profile/edit', 'POST', edit),
  profileMode: (mode: Mode) => request<ProfileState>('/api/profile/mode', 'POST', { mode }),
  addCustomer: (customer: Omit<Customer, 'id'>) => request<{ state: AppState; customer: Customer }>('/api/customers', 'POST', customer),
  addProduct: (product: Omit<Product, 'id'>) => request<{ state: AppState; product: Product }>('/api/products', 'POST', product),
  capabilities: () => request<{ voice: boolean }>('/api/capabilities'),
  edit: (edit: EditRequest) => request<EditResult>('/api/edit', 'POST', edit),
  mode: (mode: Mode) => request<AppState>('/api/mode', 'POST', { mode }),
  focus: (focus: FocusTarget | null) => request<AppState>('/api/focus', 'POST', { focus }),
  voiceToken: () => request<{ token: string }>('/api/voice-token', 'POST', {}),
  validationEvent: (kind: string, channel: 'voice' | 'text' | null) => request<{ ok: true }>('/api/validation-event', 'POST', { kind, channel }),
};
