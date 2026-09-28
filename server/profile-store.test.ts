import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store, AppError } from './store.js';
import { ProfileStore } from './profile-store.js';
import { createProfileVoiceIntegration } from '../client/src/profile-voice.js';

test('profile host supports correction, idempotency, mode guards, and scoped state', () => {
  const store = new Store();
  const profiles = new ProfileStore(store.db);
  const first = store.workspaceId(store.createWorkspace());
  const second = store.workspaceId(store.createWorkspace());
  assert.equal(profiles.getState(first).profile.name, '');
  assert.equal(profiles.getState(first).task.nextStep, 'Add a customer name');
  const set = (workspace: string, field: 'name' | 'preferredContact', value: string, revision: number, requestId: string, source: 'agent' | 'manual' = 'agent') =>
    profiles.edit(workspace, { field, value, expectedRevision: revision, requestId, source });
  assert.equal(set(first, 'name', 'Aarav Patel', 0, 'first-name').state.profile.name, 'Aarav Patel');
  assert.equal(profiles.getState(first).task.nextStep, 'Add an email or phone number');
  assert.equal(set(first, 'preferredContact', 'phone', 1, 'prefer-phone').state.profile.preferredContact, 'phone');
  assert.equal(set(first, 'preferredContact', 'email', 2, 'correct-email').state.profile.preferredContact, 'email');
  assert.equal(profiles.getState(second).profile.name, '');
  assert.equal(set(first, 'preferredContact', 'phone', 1, 'prefer-phone').applied, false);
  assert.equal(profiles.getState(first).revision, 3);
  assert.throws(() => set(first, 'name', 'Wrong', 1, 'stale-edit'), (error: unknown) => error instanceof AppError && error.status === 409);
  profiles.setMode(first, 'guide');
  assert.throws(() => set(first, 'name', 'Another', 3, 'blocked-agent'), (error: unknown) => error instanceof AppError && error.status === 403);
  assert.equal(set(first, 'name', 'Manual change', 3, 'manual-name', 'manual').state.profile.name, 'Manual change');
  profiles.setMode(first, 'collaborate');
  const undone = profiles.edit(first, { field: 'undo', expectedRevision: 4, requestId: 'undo-preference', source: 'agent' });
  assert.equal(undone.state.profile.preferredContact, 'phone');
  assert.equal(undone.state.profile.name, 'Manual change');
  assert.equal(undone.state.recentActions[0].targetField, 'preferredContact');
  assert.equal(undone.state.recentActions[1].source, 'manual');
  assert.equal(undone.state.recentActions[2].undone, true);
  assert.equal(profiles.export(first).actions.length, 5);
  store.db.close();
});

test('profile completion depends on the selected contact channel being reachable', () => {
  const store = new Store();
  const profiles = new ProfileStore(store.db);
  const id = store.workspaceId(store.createWorkspace());
  profiles.edit(id, { field: 'name', value: 'Aarav', expectedRevision: 0, requestId: 'set-name', source: 'manual' });
  const email = profiles.edit(id, { field: 'email', value: 'aarav@example.test', expectedRevision: 1, requestId: 'set-email', source: 'manual' });
  assert.equal(email.state.task.complete, true);
  const phonePreferred = profiles.edit(id, { field: 'preferredContact', value: 'phone', expectedRevision: 2, requestId: 'use-phone', source: 'manual' });
  assert.equal(phonePreferred.state.task.complete, false);
  assert.equal(phonePreferred.state.task.nextStep, 'Make the preferred contact usable');
  const phone = profiles.edit(id, { field: 'phone', value: '+91 98765 43210', expectedRevision: 3, requestId: 'set-phone', source: 'manual' });
  assert.equal(phone.state.task.complete, true);
  store.db.close();
});

test('undo refuses to overwrite a later manual change to the same field', () => {
  const store = new Store();
  const profiles = new ProfileStore(store.db);
  const id = store.workspaceId(store.createWorkspace());
  profiles.edit(id, { field: 'name', value: 'First', expectedRevision: 0, requestId: 'agent-edit', source: 'agent' });
  profiles.edit(id, { field: 'name', value: 'Manual', expectedRevision: 1, requestId: 'manual-edit', source: 'manual' });
  assert.throws(() => profiles.edit(id, { field: 'undo', expectedRevision: 2, requestId: 'undo-edit', source: 'agent' }),
    (error: unknown) => error instanceof AppError && error.code === 'undo_conflict');
  store.db.close();
});

test('profile assistant resolves “this field” from focused host context', async () => {
  const store = new Store();
  const profiles = new ProfileStore(store.db);
  const id = store.workspaceId(store.createWorkspace());
  const host = {
    getContext: async () => profiles.getState(id),
    execute: async (edit: Parameters<ProfileStore['edit']>[1]) => profiles.edit(id, edit),
    setMode: async (mode: Parameters<ProfileStore['setMode']>[1]) => profiles.setMode(id, mode),
  };
  let focused: 'email' | null = 'email';
  const integration = createProfileVoiceIntegration(host, () => focused);
  const highlights: string[] = [];
  const events = { status: () => {}, transcript: () => {}, error: () => {}, highlight: (field: string) => highlights.push(field) };
  const response = await integration.execute({ call_id: 'focus-explain', name: 'explain_field', arguments: {} }, events);
  assert.equal((response as { field: string }).field, 'email');
  assert.deepEqual(highlights, ['email']);
  focused = null;
  await assert.rejects(() => integration.execute({ call_id: 'ambiguous', name: 'explain_field', arguments: {} }, events), /No field is focused/);
  store.db.close();
});
