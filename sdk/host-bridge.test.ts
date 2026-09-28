import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostBridge } from './host-bridge.js';

type State = { revision: number; value: string };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('late reads cannot roll back a newer authoritative host state', async () => {
  const slowRead = deferred<State>();
  const changes: State[] = [];
  const bridge = createHostBridge<State, string, { state: State }>({
    read: () => slowRead.promise,
    write: async (value) => ({ state: { revision: 1, value } }),
    stateOf: (result) => result.state,
    revisionOf: (state) => state.revision,
  });
  bridge.onChange((state) => changes.push(state));
  const pendingRead = bridge.getContext();
  await bridge.execute('updated');
  slowRead.resolve({ revision: 0, value: 'old' });
  assert.deepEqual(await pendingRead, { revision: 1, value: 'updated' });
  assert.deepEqual(changes, [{ revision: 1, value: 'updated' }]);
});

test('late subscribers receive state and unsubscribe stops updates', async () => {
  let revision = 0;
  const bridge = createHostBridge<State, string, { state: State }>({
    read: async () => ({ revision, value: 'read' }),
    write: async (value) => ({ state: { revision: ++revision, value } }),
    stateOf: (result) => result.state,
    revisionOf: (state) => state.revision,
  });
  await bridge.getContext();
  const seen: string[] = [];
  const unsubscribe = bridge.onChange((state) => seen.push(state.value));
  await bridge.execute('first');
  unsubscribe();
  await bridge.execute('second');
  assert.deepEqual(seen, ['read', 'first']);
  assert.equal(bridge.current()?.value, 'second');
});

test('reset isolates users and rejects an in-flight response from the previous session', async () => {
  const oldRead = deferred<State>();
  let current: State = { revision: 4, value: 'first pilot' };
  let calls = 0;
  const bridge = createHostBridge<State, string, { state: State }>({
    read: () => ++calls === 1 ? oldRead.promise : Promise.resolve(current),
    write: async (value) => ({ state: { revision: current.revision + 1, value } }),
    stateOf: (result) => result.state,
    revisionOf: (state) => state.revision,
  });
  const pending = bridge.getContext();
  bridge.reset();
  current = { revision: 0, value: 'second pilot' };
  oldRead.resolve({ revision: 4, value: 'first pilot' });
  await assert.rejects(pending, /Host session changed/);
  assert.equal(bridge.current(), null);
  assert.deepEqual(await bridge.getContext(), current);
});
