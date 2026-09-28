import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, sep } from 'node:path';
import { Store } from '../server/store.js';
import { ProfileStore } from '../server/profile-store.js';

const dataRoot = resolve('data');
mkdirSync(dataRoot, { recursive: true });
const dataDir = mkdtempSync(resolve(dataRoot, 'pilot-smoke-'));
const invite = '0123456789abcdef0123456789abcdef';
const origin = 'https://showme.example';
const embedOrigin = 'https://pilot-host.example';
const embedSecret = 'abcdef0123456789abcdef0123456789';
const port = await new Promise<number>((resolvePort) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    const port = address.port;
    server.close(() => resolvePort(port));
  });
});
const productionEnv = {
  ...process.env, NODE_ENV: 'production', APP_ORIGIN: origin, PILOT_INVITES: invite,
  ASSEMBLYAI_API_KEY: 'smoke-test-placeholder', DATA_DIR: dataDir, PORT: String(port),
  EMBED_CLIENTS_JSON: JSON.stringify([{ id: 'pilot_host', origin: embedOrigin, secret: embedSecret }]),
};
function launch(): ChildProcess {
  return spawn(process.execPath, ['dist/server/index.js'], { cwd: process.cwd(), env: productionEnv, stdio: 'ignore' });
}
let child = launch();
const base = `http://127.0.0.1:${port}`;
async function waitReady() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { const response = await fetch(base + '/api/health'); if (response.ok) return; }
    catch { /* server is still starting */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Production server did not become ready');
}
async function stop(childProcess: ChildProcess) {
  if (childProcess.exitCode !== null) return;
  childProcess.kill();
  await new Promise<void>((done) => childProcess.once('exit', () => done()));
}
async function post(path: string, body: unknown, cookie?: string, requestOrigin = origin) {
  return fetch(base + path, {
    method: 'POST', headers: {
      Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
    }, body: JSON.stringify(body),
  });
}
try {
  await waitReady();
  const unknownApi = await fetch(base + '/api/unknown');
  assert.equal(unknownApi.status, 404);
  assert.equal(unknownApi.headers.get('content-type')?.includes('application/json'), true);
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await fetch(base + '/api/profile/state')).status, 401);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.equal((await fetch(base + '/profile')).status, 200);
  assert.equal((await fetch(base + '/widget-demo')).status, 200);
  const guideDemo = await fetch(base + '/page-guide-demo.html');
  assert.equal(guideDemo.status, 200);
  assert.match(await guideDemo.text(), /data-showme-token-endpoint="\/api\/voice-token"/);
  const embedScript = await fetch(base + '/embed/showme.js');
  assert.equal(embedScript.status, 200);
  assert.match(embedScript.headers.get('content-type') ?? '', /javascript/);
  assert.match(await embedScript.text(), /Ask ShowMe/);
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy') ?? '', /style-src[^;]*'unsafe-inline'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base + '/api/auth').then((response) => response.json())).authenticated, false);
  const embedPreflight = await fetch(base + '/api/embed/voice-token', {
    method: 'OPTIONS', headers: { Origin: embedOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization' },
  });
  assert.equal(embedPreflight.status, 204);
  assert.equal(embedPreflight.headers.get('access-control-allow-origin'), embedOrigin);
  assert.equal((await fetch(base + '/api/embed/voice-token', { method: 'OPTIONS', headers: { Origin: 'https://other.example' } })).status, 403);
  const embedSession = await fetch(base + '/api/embed/session', {
    method: 'POST', headers: { Authorization: `Bearer ${embedSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'pilot_host' }),
  });
  assert.equal(embedSession.status, 200);
  const embedSessionToken = (await embedSession.json()).sessionToken;
  assert.equal(typeof embedSessionToken, 'string');
  assert.equal((await fetch(base + '/api/embed/voice-token', { method: 'POST', headers: { Origin: 'https://other.example', Authorization: `Bearer ${embedSessionToken}` } })).status, 403);
  assert.equal((await fetch(base + '/api/embed/voice-token', { method: 'POST', headers: { Origin: embedOrigin, Authorization: 'Bearer invalid' } })).status, 401);
  assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: invite }) })).status, 403);
  assert.equal((await post('/api/login', { code: invite }, undefined, 'https://wrong.example')).status, 403);
  assert.equal((await post('/api/login', { code: 'wrong' })).status, 401);
  const login = await post('/api/login', { code: invite });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('showme_session='));
  assert.match(login.headers.get('set-cookie')!, /Secure/);
  const state = await fetch(base + '/api/state', { headers: { Cookie: cookie } });
  assert.equal(state.status, 200);
  const initial = await state.json();
  const profileResponse = await fetch(base + '/api/profile/state', { headers: { Cookie: cookie } });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.profile.name, '');
  assert.equal((await post('/api/profile/edit', { field: 'name', value: 'Pilot Customer', expectedRevision: 0, requestId: 'profile-name', source: 'manual' }, cookie, 'https://wrong.example')).status, 403);
  const profileEdit = await post('/api/profile/edit', { field: 'name', value: 'Pilot Customer', expectedRevision: 0, requestId: 'profile-name', source: 'manual' }, cookie);
  assert.equal(profileEdit.status, 200);
  assert.equal((await profileEdit.json()).state.profile.name, 'Pilot Customer');
  assert.equal(initial.customers.length, 0);
  assert.equal(initial.products.length, 0);
  const customerResponse = await post('/api/customers', { name: 'Pilot Furniture', city: 'Pune', email: 'accounts@pilot.example' }, cookie);
  assert.equal(customerResponse.status, 201);
  const customer = (await customerResponse.json()).customer;
  const productResponse = await post('/api/products', { name: 'Oak chair', description: 'Natural finish', priceCents: 250000 }, cookie);
  assert.equal(productResponse.status, 201);
  const product = (await productResponse.json()).product;
  const invoice = initial.invoice;
  const edit = await post('/api/edit', {
    operation: 'select_customer', customerId: customer.id, source: 'manual',
    expectedRevision: invoice.revision, requestId: 'production-smoke-edit',
  }, cookie);
  assert.equal(edit.status, 200);
  const itemEdit = await post('/api/edit', {
    operation: 'upsert_item', productId: product.id, quantity: 12, source: 'manual',
    expectedRevision: 1, requestId: 'production-smoke-item',
  }, cookie);
  assert.equal(itemEdit.status, 200);
  assert.equal((await itemEdit.json()).receipt.totalCents, 3000000);
  let rateLimited = false;
  for (let attempt = 0; attempt < 130; attempt++) {
    const response = await post('/api/focus', { focus: null }, cookie);
    if (response.status === 429) { rateLimited = true; break; }
    assert.equal(response.status, 200);
  }
  assert.ok(rateLimited, 'write rate limiter did not reject the burst');
  const backupPath = resolve(dataDir, 'verified-backup.sqlite');
  execFileSync(process.execPath, ['dist/scripts/backup.js', backupPath], { cwd: process.cwd(), env: productionEnv, stdio: 'pipe' });
  if (process.platform !== 'win32') {
    assert.equal(statSync(dataDir).mode & 0o777, 0o700);
    assert.equal(statSync(resolve(dataDir, 'showme.sqlite')).mode & 0o777, 0o600);
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
  }
  const backupStore = new Store(backupPath, { seedCatalog: false });
  try {
    const backedUpToken = decodeURIComponent(cookie.slice('showme_session='.length));
    assert.equal(backupStore.getState(backedUpToken).invoice.customerId, customer.id);
    const backupProfiles = new ProfileStore(backupStore.db);
    assert.equal(backupProfiles.getState(backupStore.workspaceId(backedUpToken)).profile.name, 'Pilot Customer');
  } finally { backupStore.db.close(); }
  const logout = await post('/api/logout', {}, cookie);
  assert.equal(logout.status, 200);
  assert.equal((await fetch(base + '/api/state', { headers: { Cookie: cookie } })).status, 401);
  await stop(child);
  child = launch();
  await waitReady();
  const returnLogin = await post('/api/login', { code: invite });
  const returnCookie = returnLogin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(returnCookie);
  const returnState = await fetch(base + '/api/state', { headers: { Cookie: returnCookie } });
  assert.equal((await returnState.json()).invoice.customerId, customer.id);
  const exported = await fetch(base + '/api/account/export', { headers: { Cookie: returnCookie } });
  const exportedData = await exported.json();
  assert.equal(exportedData.invoice.customerId, customer.id);
  assert.equal(exportedData.products[0].id, product.id);
  assert.equal(exportedData.customerProfile.state.profile.name, 'Pilot Customer');
  assert.equal(exportedData.customerProfile.actions.length, 1);
  const deleted = await fetch(base + '/api/account', { method: 'DELETE', headers: { Cookie: returnCookie, Origin: origin } });
  assert.equal(deleted.status, 200);
  assert.equal((await fetch(base + '/api/state', { headers: { Cookie: returnCookie } })).status, 401);
  assert.equal((await fetch(base + '/api/profile/state', { headers: { Cookie: returnCookie } })).status, 401);
  const freshLogin = await post('/api/login', { code: invite });
  assert.equal(freshLogin.status, 200);
  const freshCookie = freshLogin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(freshCookie);
  const freshInvoice = await fetch(base + '/api/state', { headers: { Cookie: freshCookie } }).then((response) => response.json());
  const freshProfile = await fetch(base + '/api/profile/state', { headers: { Cookie: freshCookie } }).then((response) => response.json());
  assert.equal(freshInvoice.invoice.customerId, null);
  assert.equal(freshProfile.profile.name, '');
  console.log('Production HTTP smoke passed: invite, origin, catalog, invoice, write limit, backup restore, restart, export, deletion.');
} finally {
  await stop(child);
  if (resolve(dataDir).startsWith(dataRoot + sep)) rmSync(dataDir, { recursive: true, force: true });
}
