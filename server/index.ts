import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store, AppError } from './store.js';
import type { FocusTarget, Mode } from '../shared/types.js';

mkdirSync(resolve('data'), { recursive: true });
const store = new Store(resolve('data/showme.sqlite'));
const app = express();
const voiceTokenRequests = new Map<string, number[]>();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

function cookieToken(header: string | undefined): string | null {
  const entry = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith('showme_session='));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice('showme_session='.length)); } catch { return null; }
}

function session(req: express.Request, res: express.Response): string {
  const existing = cookieToken(req.headers.cookie);
  if (existing && store.hasWorkspace(existing)) return existing;
  const token = store.createWorkspace();
  res.cookie('showme_session', token, {
    httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return token;
}

function requireSameOrigin(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    try { if (new URL(origin).host !== host) throw new Error('cross origin'); }
    catch { next(new AppError(403, 'cross_origin', 'Request must come from this app.')); return; }
  }
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/state', (req, res) => res.json(store.getState(session(req, res))));
app.get('/api/capabilities', (_req, res) => res.json({ voice: Boolean(process.env.ASSEMBLYAI_API_KEY) }));
app.post('/api/edit', requireSameOrigin, (req, res) => res.json(store.edit(session(req, res), req.body)));
app.post('/api/mode', requireSameOrigin, (req, res) => {
  res.json(store.setMode(session(req, res), req.body?.mode as Mode));
});
app.post('/api/focus', requireSameOrigin, (req, res) => {
  res.json(store.setFocus(session(req, res), (req.body?.focus ?? null) as FocusTarget | null));
});
app.post('/api/validation-event', requireSameOrigin, (req, res) => {
  store.recordValidationEvent(session(req, res), req.body);
  res.json({ ok: true });
});
app.post('/api/voice-token', requireSameOrigin, async (req, res, next) => {
  try {
    const token = session(req, res);
    const now = Date.now();
    const recent = (voiceTokenRequests.get(token) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= 10) throw new AppError(429, 'voice_rate_limit', 'Please wait a minute before starting another voice session.');
    recent.push(now);
    voiceTokenRequests.set(token, recent);
    const key = process.env.ASSEMBLYAI_API_KEY;
    if (!key) throw new AppError(503, 'voice_unconfigured', 'Voice is not configured on this server.');
    const endpoint = new URL('https://agents.assemblyai.com/v1/token');
    endpoint.searchParams.set('expires_in_seconds', '60');
    endpoint.searchParams.set('max_session_duration_seconds', '1800');
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new AppError(502, 'voice_provider_error', `Voice service returned ${response.status}.`);
    const data = await response.json() as { token: string };
    res.setHeader('Cache-Control', 'no-store');
    res.json({ token: data.token });
  } catch (error) { next(error); }
});

const clientDist = resolve('dist/client');
app.use(express.static(clientDist));
app.get('/{*path}', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const known = error instanceof AppError ? error : new AppError(500, 'internal_error', 'Something went wrong. Try again.');
  if (!(error instanceof AppError)) console.error(error);
  res.status(known.status).json({ error: { code: known.code, message: known.message } });
};
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`ShowMe server listening on http://localhost:${port}`));
