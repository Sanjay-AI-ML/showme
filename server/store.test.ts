import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
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

test('validation report counts outcomes without recording conversation content', () => {
  const { store, token } = fixture();
  store.recordValidationEvent(token, { kind: 'session_started', channel: 'text', content: 'private request' });
  store.recordValidationEvent(token, { kind: 'turn', channel: 'text' });
  store.recordValidationEvent(token, { kind: 'helpful_no', channel: null });
  store.recordValidationEvent(token, { kind: 'helpful_yes', channel: null });
  edit(store, token, 'select_customer', { customerId: 'sunrise' });
  edit(store, token, 'upsert_item', { productId: 'chair', quantity: 2 });
  edit(store, token, 'save_draft');
  assert.deepEqual(store.validationReport(), {
    voiceSessions: 0, textSessions: 1, userTurns: 1, assistantErrors: 0,
    draftsSaved: 1, agentEditedDrafts: 1, feedbackHelpful: 1, feedbackNeedsWork: 0,
  });
  const raw = store.db.prepare('SELECT * FROM validation_events LIMIT 1').get() as Record<string, unknown>;
  assert.equal('content' in raw, false);
  assert.throws(() => store.recordValidationEvent(token, { kind: 'unknown', channel: 'text' }),
    (error: unknown) => error instanceof AppError && error.code === 'invalid_validation_event');
});

test('pilot invitation reopens its workspace, isolates others, and sign-out revokes a session', () => {
  const store = new Store();
  const first = store.signInInvite('invite-one-hash');
  edit(store, first, 'select_customer', { customerId: 'sunrise' });
  const returnSession = store.signInInvite('invite-one-hash');
  const other = store.signInInvite('invite-two-hash');
  assert.equal(store.getState(returnSession).invoice.customerId, 'sunrise');
  assert.equal(store.getState(other).invoice.customerId, null);
  assert.notEqual(first, returnSession);
  store.revokePilotSession(first);
  assert.equal(store.pilotInviteForSession(first), null);
  assert.throws(() => store.getState(first), (error: unknown) => error instanceof AppError && error.code === 'unauthorized');
  assert.equal(store.getState(returnSession).invoice.customerId, 'sunrise');
});

test('pilot can export and permanently delete its own local workspace', () => {
  const store = new Store();
  const own = store.signInInvite('own-invite');
  const other = store.signInInvite('other-invite');
  edit(store, own, 'select_customer', { customerId: 'sunrise' });
  store.recordValidationEvent(own, { kind: 'turn', channel: 'text' });
  const exported = store.exportPilotWorkspace(own);
  assert.equal(exported.invoice.customerId, 'sunrise');
  assert.equal(exported.actions.length, 1);
  assert.equal(exported.actions[0].before.customerId, null);
  assert.equal(exported.actions[0].after.customerId, 'sunrise');
  assert.equal(exported.validationEvents.length, 1);
  store.deletePilotWorkspace(own);
  assert.equal(store.pilotInviteForSession(own), null);
  assert.throws(() => store.getState(own), (error: unknown) => error instanceof AppError && error.code === 'unauthorized');
  assert.equal(store.getState(other).invoice.customerId, null);
  const fresh = store.signInInvite('own-invite');
  assert.equal(store.getState(fresh).invoice.customerId, null);
});

test('production workspaces own their catalog and calculate totals from its prices', () => {
  const store = new Store(':memory:', { seedCatalog: false });
  const first = store.signInInvite('catalog-one');
  const second = store.signInInvite('catalog-two');
  assert.deepEqual(store.getState(first).customers, []);
  assert.deepEqual(store.getState(first).products, []);
  const { customer } = store.addCustomer(first, { name: 'Pilot Furniture', city: 'Pune', email: 'billing@pilot.example' });
  const { product } = store.addProduct(first, { name: 'Custom chair', description: 'Oak', priceCents: 345000 });
  assert.deepEqual(store.getState(second).customers, []);
  assert.deepEqual(store.getState(second).products, []);
  assert.throws(() => edit(store, second, 'select_customer', { customerId: customer.id }),
    (error: unknown) => error instanceof AppError && error.code === 'unknown_customer');
  edit(store, first, 'select_customer', { customerId: customer.id });
  edit(store, first, 'upsert_item', { productId: product.id, quantity: 3 });
  assert.equal(store.getState(first).lastAction?.totalCents, 1035000);
  assert.throws(() => store.addProduct(first, { name: 'custom CHAIR', description: '', priceCents: 1 }),
    (error: unknown) => error instanceof AppError && error.code === 'duplicate_product');
  assert.throws(() => store.addCustomer(first, { name: 'Invalid', city: 'Pune', email: 'not-email' }),
    (error: unknown) => error instanceof AppError && error.code === 'invalid_customer');
  store.deletePilotWorkspace(first);
  assert.equal((store.db.prepare('SELECT COUNT(*) AS total FROM products').get() as { total: number }).total, 0);
});

test('catalog migration preserves existing fixture-based invoice drafts', () => {
  const root = resolve('data');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(resolve(root, 'migration-test-'));
  try {
    const path = resolve(dir, 'showme.sqlite');
    const old = new Store(path);
    const token = old.createWorkspace();
    edit(old, token, 'select_customer', { customerId: 'sunrise' });
    edit(old, token, 'upsert_item', { productId: 'chair', quantity: 2 });
    old.db.exec('DELETE FROM customers; DELETE FROM products; PRAGMA user_version = 0;');
    old.db.close();
    const migrated = new Store(path, { seedCatalog: false });
    assert.equal(migrated.getState(token).invoice.customerId, 'sunrise');
    assert.equal(migrated.getState(token).lastAction?.totalCents, 500000);
    assert.ok(migrated.getState(token).customers.some((customer) => customer.id === 'sunrise'));
    assert.ok(migrated.getState(token).products.some((product) => product.id === 'chair'));
    const added = migrated.addProduct(token, { name: 'Custom shelf', description: 'Wall mounted', priceCents: 12345 }).product;
    migrated.db.close();
    const reopened = new Store(path, { seedCatalog: false });
    assert.ok(reopened.getState(token).products.some((product) => product.id === added.id && product.priceCents === 12345));
    reopened.db.close();
  } finally {
    assert.ok(resolve(dir).startsWith(root + sep));
    rmSync(dir, { recursive: true, force: true });
  }
});
