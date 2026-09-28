import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EmbedSessions } from './embed.js';
import { AppError } from './store.js';

const clients = JSON.stringify([{ id: 'pilot_app', origin: 'https://pilot.example', secret: '0123456789abcdef0123456789abcdef' }]);

test('host server can mint an origin-bound short-lived embed session', () => {
  const sessions = new EmbedSessions(clients, true);
  assert.equal(sessions.enabled(), true);
  assert.equal(sessions.allowsOrigin('https://pilot.example'), true);
  assert.equal(sessions.allowsOrigin('https://other.example'), false);
  assert.throws(() => sessions.create('pilot_app', 'wrong'), (error: unknown) => error instanceof AppError && error.status === 401);
  const { sessionToken, expiresInSeconds } = sessions.create('pilot_app', '0123456789abcdef0123456789abcdef');
  assert.equal(expiresInSeconds, 600);
  assert.equal(sessions.verify(sessionToken, 'https://pilot.example'), 'pilot_app');
  assert.throws(() => sessions.verify(sessionToken, 'https://other.example'), (error: unknown) => error instanceof AppError && error.status === 401);
  assert.throws(() => sessions.verify('invented', 'https://pilot.example'), (error: unknown) => error instanceof AppError && error.status === 401);
});

test('production rejects invalid embed origins and duplicate clients', () => {
  assert.throws(() => new EmbedSessions('[{"id":"pilot_app","origin":"http://pilot.example","secret":"0123456789abcdef0123456789abcdef"}]', true), /HTTPS/);
  assert.throws(() => new EmbedSessions(JSON.stringify([
    { id: 'pilot_app', origin: 'https://pilot.example', secret: '0123456789abcdef0123456789abcdef' },
    { id: 'pilot_app', origin: 'https://other.example', secret: 'fedcba9876543210fedcba9876543210' },
  ]), true), /duplicate/);
});
