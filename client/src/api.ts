import type { AppState, EditRequest, EditResult, FocusTarget, Mode } from '../../shared/types';

async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
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
  state: () => request<AppState>('/api/state'),
  capabilities: () => request<{ voice: boolean }>('/api/capabilities'),
  edit: (edit: EditRequest) => request<EditResult>('/api/edit', 'POST', edit),
  mode: (mode: Mode) => request<AppState>('/api/mode', 'POST', { mode }),
  focus: (focus: FocusTarget | null) => request<AppState>('/api/focus', 'POST', { focus }),
  voiceToken: () => request<{ token: string }>('/api/voice-token', 'POST', {}),
  validationEvent: (kind: string, channel: 'voice' | 'text' | null) => request<{ ok: true }>('/api/validation-event', 'POST', { kind, channel }),
};
