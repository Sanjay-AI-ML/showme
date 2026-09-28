import { createHostBridge } from '../sdk/host-bridge.js';

/** Example host contract for a separate customer-profile application. */
export interface ProfileContext {
  revision: number;
  customerId: string;
  displayName: string;
  preferredContact: 'email' | 'phone';
}

export interface ProfileAction {
  operation: 'rename_customer' | 'set_contact_preference';
  expectedRevision: number;
  requestId: string;
  displayName?: string;
  preferredContact?: 'email' | 'phone';
}

export function createProfileHost(paths = { context: '/api/profile/context', actions: '/api/profile/actions' }) {
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { credentials: 'same-origin', ...init });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? `Host request failed (${response.status})`);
    return data as T;
  }

  return createHostBridge<ProfileContext, ProfileAction, { state: ProfileContext }>({
    read: () => json<ProfileContext>(paths.context),
    write: (action) => json<{ state: ProfileContext }>(paths.actions, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
    }),
    stateOf: (result) => result.state,
    revisionOf: (state) => state.revision,
  });
}
