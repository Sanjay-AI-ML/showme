import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createWidgetController } from '../sdk/widget.js';
import { ShowMeVoice } from '../sdk/voice.js';
import { Store } from '../server/store.js';
import { ProfileStore } from '../server/profile-store.js';
import type { ProfileField } from '../shared/profile.js';

const store = new Store();
const workspaceId = store.workspaceId(store.createWorkspace());
const profiles = new ProfileStore(store.db);
const editable: ProfileField[] = ['name', 'preferredContact'];
const controller = createWidgetController({
  name: 'Customer profile',
  read: async () => profiles.getState(workspaceId),
  revisionOf: (state) => state.revision,
  summarize: (state) => ({ profile: state.profile, revision: state.revision }),
  actions: [{
    name: 'set_profile_field',
    description: 'Set the customer profile field to the exact value requested.',
    parameters: { type: 'object', properties: {
      field: { type: 'string', enum: editable }, value: { type: 'string' },
    }, required: ['field', 'value'] },
    async run(args, { expectedRevision, requestId }) {
      if (!editable.includes(args.field as ProfileField) || typeof args.value !== 'string') throw new Error('Invalid profile edit.');
      return profiles.edit(workspaceId, { field: args.field, value: args.value, expectedRevision, requestId, source: 'agent' }).state;
    },
  }],
});
let agentError = '';
const replies: string[] = [];
const agent = new ShowMeVoice(controller.integration, {
  status: () => {}, transcript: (speaker, message) => { if (speaker === 'agent') replies.push(message); },
  highlight: () => {}, error: (message) => { agentError = message; },
}, { tokenProvider: async () => {
  const response = await fetch('http://localhost:3001/api/voice-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' }, body: '{}',
  });
  if (!response.ok) throw new Error(`Voice token endpoint returned ${response.status}`);
  return response.json();
} });

async function waitFor(check: () => boolean, label: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (agentError) throw new Error(agentError);
    if (check()) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}; agent replies: ${replies.join(' | ')}`);
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
  assert.equal(replies.some((reply) => /Hi,? I(?:’|'| a)m ShowMe|What would you like to do in/i.test(reply)), false,
    `A typed request received a startup greeting: ${replies.join(' | ')}`);
  console.log('Live widget text-agent smoke passed: name, preference, and correction.');
} finally { await agent.stop(); store.db.close(); }
