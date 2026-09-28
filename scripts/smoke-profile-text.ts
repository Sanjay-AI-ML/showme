import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { api } from '../client/src/api.js';
import { createProfileVoiceIntegration } from '../client/src/profile-voice.js';
import { ShowMeVoice } from '../client/src/voice.js';
import { Store } from '../server/store.js';
import { ProfileStore } from '../server/profile-store.js';

api.voiceToken = async () => {
  const response = await fetch('http://localhost:3001/api/voice-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' }, body: '{}',
  });
  if (!response.ok) throw new Error(`Voice token endpoint returned ${response.status}`);
  return response.json();
};
const store = new Store();
const workspaceId = store.workspaceId(store.createWorkspace());
const profiles = new ProfileStore(store.db);
const host = {
  getContext: async () => profiles.getState(workspaceId),
  execute: async (edit: Parameters<ProfileStore['edit']>[1]) => profiles.edit(workspaceId, edit),
  setMode: async (mode: Parameters<ProfileStore['setMode']>[1]) => profiles.setMode(workspaceId, mode),
};
let agentError = '';
const agentMessages: string[] = [];
const agent = new ShowMeVoice(createProfileVoiceIntegration(host), {
  status: () => {}, transcript: (speaker, text) => { if (speaker === 'agent') agentMessages.push(text); },
  highlight: () => {}, error: (message) => { agentError = message; },
}, { tokenProvider: api.voiceToken });
async function waitFor(check: () => boolean, label: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (agentError) throw new Error(agentError);
    if (check()) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}; agent replies: ${agentMessages.join(' | ')}`);
}
try {
  await agent.start('text');
  agent.sayText('Set this customer name to Aarav Patel.');
  await waitFor(() => profiles.getState(workspaceId).profile.name === 'Aarav Patel', 'name edit');
  agent.sayText('Use phone as the preferred contact.');
  await waitFor(() => profiles.getState(workspaceId).profile.preferredContact === 'phone', 'phone preference');
  agent.sayText('Actually, use email instead.');
  await waitFor(() => profiles.getState(workspaceId).profile.preferredContact === 'email', 'correction');
  assert.equal(profiles.getState(workspaceId).revision, 3);
  console.log('Live profile text-agent smoke passed: name, preference, and correction.');
} finally { await agent.stop(); store.db.close(); }
