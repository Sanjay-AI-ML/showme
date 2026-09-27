import assert from 'node:assert/strict';
import test from 'node:test';
import { Store, AppError } from './store.js';

function fixture() { const store = new Store(); const token = store.createWorkspace(); return { store, token }; }
function edit(store: Store, token: string, operation: string, extras: Record<string, unknown> = {}, source = 'agent') {
  return store.edit(token, {
    operation, expectedRevision: store.getState(token).invoice.revision,
    requestId: crypto.randomUUID(), source, ...extras,
  });
}

test('agent corrections update one item and authoritative total', () => {
  const { store, token } = fixture();
  edit(store, token, 'select_customer', { customerId: 'sunrise' });
  edit(store, token, 'upsert_item', { productId: 'chair', quantity: 12 });
  edit(store, token, 'set_delivery', { deliveryCents: 50000 });
  assert.equal(store.getState(token).lastAction?.totalCents, 3050000);
  edit(store, token, 'upsert_item', { productId: 'chair', quantity: 10 });
  assert.equal(store.getState(token).invoice.items[0].quantity, 10);
  assert.equal(store.getState(token).lastAction?.totalCents, 2550000);
});

test('guide mode blocks agent changes but allows manual editing', () => {
  const { store, token } = fixture();
  store.setMode(token, 'guide');
  assert.throws(() => edit(store, token, 'set_delivery', { deliveryCents: 50000 }), (error: unknown) => error instanceof AppError && error.code === 'mode_disallows_action');
  edit(store, token, 'set_delivery', { deliveryCents: 50000 }, 'manual');
  assert.equal(store.getState(token).invoice.deliveryCents, 50000);
});

test('stale edits are rejected and request ids prevent duplicates', () => {
  const { store, token } = fixture();
  const request = { operation: 'set_delivery', expectedRevision: 0, requestId: 'unique-operation', source: 'agent', deliveryCents: 50000 };
  const first = store.edit(token, request);
  const retry = store.edit(token, request);
  assert.equal(retry.receipt.id, first.receipt.id);
  assert.equal(store.getState(token).invoice.revision, 1);
  assert.throws(() => store.edit(token, { ...request, requestId: 'second-operation' }), (error: unknown) => error instanceof AppError && error.code === 'stale_revision');
});

test('undo restores agent delivery change without reverting later manual terms', () => {
  const { store, token } = fixture();
  edit(store, token, 'set_delivery', { deliveryCents: 50000 });
  edit(store, token, 'set_terms', { terms: 'net_15' }, 'manual');
  edit(store, token, 'undo');
  assert.equal(store.getState(token).invoice.deliveryCents, 0);
  assert.equal(store.getState(token).invoice.terms, 'net_15');
});

test('saved drafts require customer and item and become drafts after edits', () => {
  const { store, token } = fixture();
  assert.throws(() => edit(store, token, 'save_draft'), (error: unknown) => error instanceof AppError && error.code === 'incomplete_invoice');
  edit(store, token, 'select_customer', { customerId: 'sunrise' });
  edit(store, token, 'upsert_item', { productId: 'chair', quantity: 2 });
  edit(store, token, 'save_draft');
  assert.equal(store.getState(token).invoice.status, 'saved');
  edit(store, token, 'set_delivery', { deliveryCents: 10000 });
  assert.equal(store.getState(token).invoice.status, 'draft');
});

test('one workspace cannot read or change another workspace through its token', () => {
  const store = new Store();
  const first = store.createWorkspace();
  const second = store.createWorkspace();
  edit(store, first, 'select_customer', { customerId: 'sunrise' });
  assert.equal(store.getState(first).invoice.customerId, 'sunrise');
  assert.equal(store.getState(second).invoice.customerId, null);
  assert.notEqual(store.getState(first).invoice.id, store.getState(second).invoice.id);
});

test('undo rejects a conflict instead of overwriting a newer manual change', () => {
  const { store, token } = fixture();
  edit(store, token, 'set_delivery', { deliveryCents: 50000 });
  edit(store, token, 'set_delivery', { deliveryCents: 70000 }, 'manual');
  assert.throws(() => edit(store, token, 'undo'), (error: unknown) => error instanceof AppError && error.code === 'undo_conflict');
  assert.equal(store.getState(token).invoice.deliveryCents, 70000);
});
