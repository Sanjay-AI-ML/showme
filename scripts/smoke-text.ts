import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { api } from '../client/src/api.js';
import { ShowMeVoice } from '../client/src/voice.js';
import { createInvoiceVoiceIntegration } from '../client/src/invoice-voice.js';
import type { HostAdapter } from '../client/src/host.js';
import { Store } from '../server/store.js';

api.voiceToken = async () => {
  const response = await fetch('http://localhost:3001/api/voice-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' }, body: '{}',
  });
  if (!response.ok) throw new Error(`Voice token endpoint returned ${response.status}`);
  return response.json();
};

const store = new Store();
const token = store.createWorkspace();
const host: HostAdapter = {
  getContext: async () => store.getState(token),
  execute: async (edit) => store.edit(token, edit),
  setMode: async (mode) => store.setMode(token, mode),
  focus: async (target) => store.setFocus(token, target),
  onChange: () => () => {},
};
let agentError = '';
const agentMessages: string[] = [];
const agent = new ShowMeVoice(createInvoiceVoiceIntegration(host), {
  status: () => {}, transcript: (speaker, text) => { if (speaker === 'agent') agentMessages.push(text); }, highlight: () => {},
  error: (message) => { agentError = message; },
}, { tokenProvider: api.voiceToken });

async function waitFor(check: () => boolean, label: string) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (agentError) throw new Error(agentError);
    if (check()) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}; agent replies: ${agentMessages.join(' | ')}`);
}

try {
  await agent.start('text');
  agent.sayText('Set the customer to Sunrise Studio.');
  await waitFor(() => store.getState(token).invoice.customerId === 'sunrise', 'customer selection');
  agent.sayText('Add two oak chairs.');
  await waitFor(() => store.getState(token).invoice.items[0]?.quantity === 2, 'item addition');
  agent.sayText('Charge 500 rupees for delivery separately.');
  await waitFor(() => store.getState(token).invoice.deliveryCents === 50000, 'delivery charge');
  const priorReplies = agentMessages.length;
  agent.sayText('Save the draft.');
  await waitFor(() => store.getState(token).invoice.status === 'saved', 'saved draft');
  await waitFor(() => agentMessages.slice(priorReplies).some((reply) => /\bsaved\b/i.test(reply)), 'spoken save confirmation');
  assert.equal(store.getState(token).lastAction?.totalCents, 550000);
  console.log('Live text-agent smoke test passed: customer, item, delivery, and saved total.');
} finally {
  await agent.stop();
}
