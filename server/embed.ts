import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './store.js';

const clientSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
  origin: z.url(),
  secret: z.string().min(32),
});
type Client = z.infer<typeof clientSchema>;
const digest = (value: string) => createHash('sha256').update(value).digest();

/** Short-lived browser sessions minted only for a registered host server. */
export class EmbedSessions {
  private clients = new Map<string, Client>();
  private sessions = new Map<string, { clientId: string; expiresAt: number }>();

  constructor(json: string | undefined, production: boolean) {
    if (!json) return;
    let raw: unknown;
    try { raw = JSON.parse(json); } catch { throw new Error('EMBED_CLIENTS_JSON must be valid JSON.'); }
    const parsed = z.array(clientSchema).max(50).safeParse(raw);
    if (!parsed.success) throw new Error('EMBED_CLIENTS_JSON must be an array of clients with id, origin, and 32+ character secret.');
    for (const client of parsed.data) {
      const url = new URL(client.origin);
      if (url.origin !== client.origin || (production && url.protocol !== 'https:'))
        throw new Error('Each embed origin must be one exact HTTPS origin in production.');
      if (this.clients.has(client.id)) throw new Error('EMBED_CLIENTS_JSON contains a duplicate client id.');
      this.clients.set(client.id, client);
    }
  }

  enabled() { return this.clients.size > 0; }
  allowsOrigin(origin: string) { return [...this.clients.values()].some((client) => client.origin === origin); }

  create(clientId: string, secret: string): { sessionToken: string; expiresInSeconds: number } {
    const client = this.clients.get(clientId);
    if (!client || !timingSafeEqual(digest(secret), digest(client.secret)))
      throw new AppError(401, 'invalid_embed_client', 'Invalid ShowMe embed credentials.');
    const now = Date.now();
    for (const [tokenHash, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(tokenHash);
    if (this.sessions.size >= 5000) throw new AppError(429, 'embed_capacity', 'Too many active ShowMe sessions.');
    const sessionToken = randomBytes(32).toString('base64url');
    const expiresInSeconds = 10 * 60;
    this.sessions.set(digest(sessionToken).toString('hex'), { clientId, expiresAt: now + expiresInSeconds * 1000 });
    return { sessionToken, expiresInSeconds };
  }

  verify(sessionToken: string, origin: string): string {
    const session = this.sessions.get(digest(sessionToken).toString('hex'));
    const client = session && this.clients.get(session.clientId);
    if (!session || !client || session.expiresAt <= Date.now() || client.origin !== origin)
      throw new AppError(401, 'invalid_embed_session', 'ShowMe embed session expired or invalid.');
    return client.id;
  }
}
