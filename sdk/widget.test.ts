import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWidgetController } from './widget.js';

test('widget only executes registered actions with revision context and mode guard', async () => {
  let state = { revision: 0, status: 'new' };
  const calls: { expectedRevision: number; requestId: string }[] = [];
  const controller = createWidgetController({
    name: 'Ticket editor', read: async () => state, revisionOf: (value) => value.revision,
    summarize: (value) => ({ status: value.status }),
    actions: [{ name: 'set_status', description: 'Set the ticket status.',
      parameters: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] },
      async run(args, context) {
        calls.push({ expectedRevision: context.expectedRevision, requestId: context.requestId });
        state = { revision: state.revision + 1, status: String(args.status) };
        return state;
      },
    }],
  });
  const events = { status: () => {}, transcript: () => {}, error: () => {}, highlight: () => {} };
  const read = await controller.integration.execute({ call_id: 'read-1', name: 'read_context', arguments: {} }, events);
  assert.deepEqual((read as { task: unknown }).task, { status: 'new' });
  await assert.rejects(() => controller.integration.execute({ call_id: 'unknown-1', name: 'delete_ticket', arguments: {} }, events), /Unsupported action/);
  await controller.setMode('guide');
  await assert.rejects(() => controller.integration.execute({ call_id: 'blocked-1', name: 'set_status', arguments: { status: 'open' } }, events), /does not allow edits/);
  assert.equal(state.status, 'new');
  await controller.setMode('collaborate');
  await controller.integration.execute({ call_id: 'edit-1', name: 'set_status', arguments: { status: 'open' } }, events);
  assert.deepEqual(calls, [{ expectedRevision: 0, requestId: 'edit-1' }]);
  assert.deepEqual(state, { revision: 1, status: 'open' });
});

test('widget rejects ambiguous or duplicate action registrations', () => {
  const action = { name: 'set_status', description: 'Set status', parameters: { type: 'object' }, run: async () => ({ revision: 1 }) };
  assert.throws(() => createWidgetController({ name: 'Tickets', read: async () => ({ revision: 0 }), revisionOf: (s) => s.revision,
    summarize: (s) => s, actions: [action, action] }), /duplicate/);
});
