import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Store, AppError } from './store.js';
import { ProfileStore } from './profile-store.js';
import { EmbedSessions } from './embed.js';
import type { FocusTarget, Mode } from '../shared/types.js';

const production = process.env.NODE_ENV === 'production';
const appOrigin = process.env.APP_ORIGIN;
const inviteCodes = (process.env.PILOT_INVITES ?? '').split(',').map((code) => code.trim()).filter(Boolean);
if (production) {
  if (!appOrigin || new URL(appOrigin).protocol !== 'https:' || new URL(appOrigin).origin !== appOrigin) {
    throw new Error('Production requires APP_ORIGIN to be one exact HTTPS origin.');
  }
  if (!inviteCodes.length || inviteCodes.some((code) => code.length < 32) || new Set(inviteCodes).size !== inviteCodes.length) {
    throw new Error('Production requires unique PILOT_INVITES codes of at least 32 characters.');
  }
  if (!process.env.ASSEMBLYAI_API_KEY) throw new Error('Production requires ASSEMBLYAI_API_KEY.');
  if (!process.env.DATA_DIR || !isAbsolute(process.env.DATA_DIR)) throw new Error('Production requires an absolute DATA_DIR on persistent storage.');
}
const inviteHashes = inviteCodes.map((code) => createHash('sha256').update(code).digest());
const activeInviteHashes = new Set(inviteHashes.map((digest) => digest.toString('hex')));
const embedSessions = new EmbedSessions(process.env.EMBED_CLIENTS_JSON, production);
const dataDir = resolve(process.env.DATA_DIR ?? 'data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
if (production) chmodSync(dataDir, 0o700);
const databasePath = resolve(dataDir, 'showme.sqlite');
const store = new Store(databasePath, { seedCatalog: !production });
if (production) chmodSync(databasePath, 0o600);
const profileStore = new ProfileStore(store.db);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use('/api', (req, res, next) => {
  const requestId = randomUUID();
  const started = performance.now();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => console.log(JSON.stringify({
    requestId, method: req.method, path: req.path, status: res.statusCode,
    durationMs: Math.round(performance.now() - started),
  })));
  next();
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  if (production) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self' blob:", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "connect-src 'self' wss://agents.assemblyai.com",
      "worker-src 'self' blob:", "img-src 'self' data:", "object-src 'none'", "base-uri 'self'",
      "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '));
  }
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '32kb' }));

const attempts = new Map<string, number[]>();
function limit(key: string, maximum: number, windowMs: number): void {
  const now = Date.now();
  if (attempts.size > 5000) {
    for (const [entry, times] of attempts) if (times[times.length - 1] < now - windowMs) attempts.delete(entry);
    while (attempts.size > 5000) attempts.delete(attempts.keys().next().value!);
  }
  const recent = (attempts.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= maximum) throw new AppError(429, 'rate_limit', 'Too many attempts. Please try again later.');
  recent.push(now);
  attempts.set(key, recent);
}
const writeRoutes = new Set(['/api/edit', '/api/profile/edit', '/api/mode', '/api/profile/mode',
  '/api/focus', '/api/customers', '/api/products', '/api/validation-event']);
app.use('/api', (req, _res, next) => {
  if (req.method !== 'POST' || !writeRoutes.has(req.originalUrl.split('?')[0])) { next(); return; }
  try {
    limit(`write-ip:${req.ip}`, 300, 60_000);
    const token = cookieToken(req.headers.cookie);
    if (token) limit(`write-session:${createHash('sha256').update(token).digest('hex')}`, 120, 60_000);
    next();
  } catch (error) { next(error); }
});
function cookieToken(header: string | undefined): string | null {
  const entry = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith('showme_session='));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice('showme_session='.length)); } catch { return null; }
}
function setSessionCookie(req: express.Request, res: express.Response, token: string): void {
  res.cookie('showme_session', token, {
    httpOnly: true, sameSite: 'strict', secure: production || req.secure, path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
function session(req: express.Request, res: express.Response): string {
  const existing = cookieToken(req.headers.cookie);
  if (production) {
    if (existing) {
      const invite = store.pilotInviteForSession(existing);
      if (invite && activeInviteHashes.has(invite)) return existing;
    }
    throw new AppError(401, 'sign_in_required', 'Enter your pilot invitation to continue.');
  }
  if (existing && store.hasWorkspace(existing)) return existing;
  const token = store.createWorkspace();
  setSessionCookie(req, res, token);
  return token;
}
function requireSameOrigin(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  const expected = appOrigin ?? `${req.protocol}://${req.headers.host}`;
  if (!req.headers.origin || req.headers.origin !== expected) {
    next(new AppError(403, 'cross_origin', 'Request must come from this app.'));
    return;
  }
  next();
}

app.get('/api/health', (_req, res) => {
  store.db.prepare('SELECT 1').get();
  res.json({ ok: true });
});
app.get('/api/auth', (req, res) => {
  const token = cookieToken(req.headers.cookie);
  const authenticated = production ? Boolean(token && activeInviteHashes.has(store.pilotInviteForSession(token) ?? '')) : true;
  res.json({ required: production, authenticated });
});
app.post('/api/login', requireSameOrigin, (req, res) => {
  if (!production) throw new AppError(404, 'not_found', 'Pilot sign-in is not enabled locally.');
  limit(`login:${req.ip}`, 8, 15 * 60_000);
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const digest = createHash('sha256').update(code).digest();
  const match = inviteHashes.find((valid) => timingSafeEqual(valid, digest));
  if (!match) throw new AppError(401, 'invalid_invite', 'That invitation code is invalid.');
  const token = store.signInInvite(match.toString('hex'));
  setSessionCookie(req, res, token);
  res.json({ ok: true });
});
app.post('/api/logout', requireSameOrigin, (req, res) => {
  const token = cookieToken(req.headers.cookie);
  if (token && production) store.revokePilotSession(token);
  res.clearCookie('showme_session', { path: '/', secure: production || req.secure, sameSite: 'strict' });
  res.json({ ok: true });
});
app.get('/api/account/export', (req, res) => {
  const token = session(req, res);
  res.json({ ...store.exportPilotWorkspace(token), customerProfile: profileStore.export(store.workspaceId(token)) });
});
app.delete('/api/account', requireSameOrigin, (req, res) => {
  store.deletePilotWorkspace(session(req, res));
  res.clearCookie('showme_session', { path: '/', secure: production || req.secure, sameSite: 'strict' });
  res.json({ ok: true });
});
app.get('/api/state', (req, res) => res.json(store.getState(session(req, res))));
app.get('/api/profile/state', (req, res) => res.json(profileStore.getState(store.workspaceId(session(req, res)))));
app.post('/api/profile/edit', requireSameOrigin, (req, res) => res.json(profileStore.edit(store.workspaceId(session(req, res)), req.body)));
app.post('/api/profile/mode', requireSameOrigin, (req, res) => res.json(profileStore.setMode(store.workspaceId(session(req, res)), req.body?.mode)));
app.post('/api/customers', requireSameOrigin, (req, res) => res.status(201).json(store.addCustomer(session(req, res), req.body)));
app.post('/api/products', requireSameOrigin, (req, res) => res.status(201).json(store.addProduct(session(req, res), req.body)));
app.get('/api/capabilities', (_req, res) => res.json({ voice: Boolean(process.env.ASSEMBLYAI_API_KEY) }));
app.post('/api/edit', requireSameOrigin, (req, res) => res.json(store.edit(session(req, res), req.body)));
app.post('/api/mode', requireSameOrigin, (req, res) => res.json(store.setMode(session(req, res), req.body?.mode as Mode)));
app.post('/api/focus', requireSameOrigin, (req, res) => res.json(store.setFocus(session(req, res), (req.body?.focus ?? null) as FocusTarget | null)));
app.post('/api/validation-event', requireSameOrigin, (req, res) => {
  store.recordValidationEvent(session(req, res), req.body);
  res.json({ ok: true });
});
async function mintVoiceToken(): Promise<{ token: string }> {
    const key = process.env.ASSEMBLYAI_API_KEY;
    if (!key) throw new AppError(503, 'voice_unconfigured', 'Voice is not configured on this server.');
    const endpoint = new URL('https://agents.assemblyai.com/v1/token');
    endpoint.searchParams.set('expires_in_seconds', '60');
    endpoint.searchParams.set('max_session_duration_seconds', '1800');
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new AppError(502, 'voice_provider_error', `Voice service returned ${response.status}.`);
    const data = await response.json() as { token?: string };
    if (!data.token) throw new AppError(502, 'voice_provider_error', 'Voice service returned an invalid token.');
    return { token: data.token };
}
function providerError(error: unknown): unknown {
  return error instanceof Error && error.name === 'TimeoutError'
    ? new AppError(502, 'voice_provider_timeout', 'Voice service did not respond in time.') : error;
}
app.post('/api/voice-token', requireSameOrigin, async (req, res, next) => {
  try {
    const token = session(req, res);
    limit(`voice-session:${token}`, 10, 60_000);
    limit(`voice-ip:${req.ip}`, 30, 60_000);
    res.json(await mintVoiceToken());
  } catch (error) { next(providerError(error)); }
});

app.post('/api/embed/session', (req, res) => {
  if (!embedSessions.enabled()) throw new AppError(404, 'embed_unconfigured', 'ShowMe embedding is not configured.');
  limit(`embed-create-ip:${req.ip}`, 30, 60_000);
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : '';
  const authorization = req.headers.authorization ?? '';
  const secret = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  res.json(embedSessions.create(clientId, secret));
});
function embedCors(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = req.headers.origin;
  if (!origin || !embedSessions.allowsOrigin(origin)) { next(new AppError(403, 'embed_origin', 'This website is not registered for ShowMe.')); return; }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');
  next();
}
app.options('/api/embed/voice-token', embedCors, (_req, res) => res.sendStatus(204));
app.post('/api/embed/voice-token', embedCors, async (req, res, next) => {
  try {
    const authorization = req.headers.authorization ?? '';
    const sessionToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const clientId = embedSessions.verify(sessionToken, req.headers.origin!);
    limit(`embed-voice-session:${createHash('sha256').update(sessionToken).digest('hex')}`, 10, 60_000);
    limit(`embed-voice-client:${clientId}`, 100, 60_000);
    limit(`embed-voice-ip:${req.ip}`, 30, 60_000);
    res.json(await mintVoiceToken());
  } catch (error) { next(providerError(error)); }
});
app.use('/api', (_req, _res, next) => next(new AppError(404, 'not_found', 'API route not found.')));

const clientDist = resolve('dist/client');
app.use('/assets', express.static(resolve(clientDist, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(clientDist, { index: false, maxAge: 0 }));
app.get('/{*path}', (_req, res) => res.setHeader('Cache-Control', 'no-store').sendFile(resolve(clientDist, 'index.html')));
const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const known = error instanceof AppError ? error : new AppError(500, 'internal_error', 'Something went wrong. Try again.');
  if (!(error instanceof AppError)) console.error(JSON.stringify({ requestId: res.locals.requestId, error: String(error) }));
  res.status(known.status).json({ error: { code: known.code, message: known.message, requestId: res.locals.requestId } });
};
app.use(errorHandler);
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => console.log(`ShowMe server listening on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { store.db.close(); process.exit(0); }));
}
