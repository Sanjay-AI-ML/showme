import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createProfileHost, type ProfileContext } from './profile-host.js';

test('profile app integrates through the same bridge used by the invoice app', async () => {
  let state: ProfileContext = { revision: 0, customerId: 'p-1', displayName: 'Pilot', preferredContact: 'email' };
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/context') { res.end(JSON.stringify(state)); return; }
    if (req.url === '/actions' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const action = JSON.parse(raw);
      if (action.expectedRevision !== state.revision) {
        res.statusCode = 409;
        res.end(JSON.stringify({ error: { message: 'Profile changed. Refresh before editing.' } }));
        return;
      }
      state = { ...state, revision: state.revision + 1, preferredContact: action.preferredContact };
      res.end(JSON.stringify({ state }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    const base = `http://127.0.0.1:${address.port}`;
    const host = createProfileHost({ context: `${base}/context`, actions: `${base}/actions` });
    const seen: ProfileContext[] = [];
    host.onChange((snapshot) => seen.push(snapshot));
    const initial = await host.getContext();
    assert.equal(initial.preferredContact, 'email');
    const result = await host.execute({ operation: 'set_contact_preference', preferredContact: 'phone',
      expectedRevision: initial.revision, requestId: 'profile-test' });
    assert.equal(result.state.preferredContact, 'phone');
    assert.deepEqual(seen.map((snapshot) => snapshot.revision), [0, 1]);
    await assert.rejects(() => host.execute({ operation: 'set_contact_preference', preferredContact: 'email',
      expectedRevision: 0, requestId: 'stale-profile-test' }), /Profile changed/);
  } finally { await new Promise<void>((done) => server.close(() => done())); }
});
