# Invite-only pilot deployment

ShowMe is packaged for one Node process on one VPS or container. The app requires Node 24, persistent SQLite storage, a TLS reverse proxy, and an AssemblyAI API key. Do not run multiple replicas against this SQLite database. Production mode refuses to start without an exact HTTPS `APP_ORIGIN`, at least one 32-character invitation, an absolute `DATA_DIR`, and the provider key.

## Prepare

1. Rotate the AssemblyAI key previously shared in chat. Use the replacement key only in the server's private environment.
2. Generate one unique high-entropy invitation per pilot. For example, run `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` once per person. Codes are bearer credentials: anyone with a code can reopen that pilot's workspace. Do not reuse or publish them.
3. Put production variables in a private `.env.production` file on the VPS:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://showme.example.com
PILOT_INVITES=first-random-code,second-random-code
ASSEMBLYAI_API_KEY=your-rotated-key
TRUST_PROXY=1
PORT=3001
DATA_DIR=/app/data
```

The file is excluded from Docker builds and Git. Replace the domain and codes with real values. Keep the VPS firewall closed to port 3001; only the TLS proxy should reach it. `TRUST_PROXY=1` assumes exactly one trusted proxy hop.

## Container

```sh
docker build -t showme:pilot .
docker volume create showme-data
docker run -d --name showme --restart unless-stopped \
  --env-file .env.production \
  -p 127.0.0.1:3001:3001 \
  -v showme-data:/app/data \
  showme:pilot
```

Point the domain to the VPS and terminate HTTPS with a reverse proxy. A host-installed Caddy configuration is:

```caddyfile
showme.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Check `https://showme.example.com/api/health` for `{"ok":true}`. The root page should display invite sign-in. A pilot's code opens their draft on subsequent visits. Removing a code from `PILOT_INVITES` and restarting the container immediately blocks its existing sessions. The data remains on the volume; code rotation does not migrate a workspace.

## Operate

- Back up the live SQLite database regularly. The image includes a compiled backup command: `docker run --rm --env-file .env.production -v showme-data:/app/data -v /safe/backups:/backups showme:pilot node dist/scripts/backup.js /backups/showme-YYYY-MM-DD.sqlite`. Ensure the backup directory is writable by UID 1000. The command uses SQLite's online backup API, sets the copy to mode `0600`, and verifies integrity. Encrypt backups, store a copy off the VPS, and rehearse restoration before inviting users. The automated production smoke test restores a copy and checks invoice and profile data.
- Monitor container restarts, `/api/health`, reverse-proxy HTTPS errors, disk space, and AssemblyAI usage. The health route verifies SQLite availability, but it does not probe the provider. The app limits one signed-in session to 120 write requests per minute and one IP to 300 per minute; add proxy-level abuse controls before a larger release.
- Deploy one instance at a time, preserve the data volume, and test sign-in, voice, correction, save, and return login after each release.
- Pilots can export their invoice, customer-profile, and action history and delete their active workspace from **Account & data**, accessible from both host screens. Deletion removes the live SQLite records and sessions, but it cannot erase copies in backups or data held by AssemblyAI. Define backup and provider retention before handling real customer data.
- Never put a real key or invitation in Git, a client bundle, browser console, analytics, or support screenshots. `/api/voice-token` issues a short-lived provider token only after sign-in and rate checks.

## Embedding in another website

The [widget integration guide](sdk/README.md) shows the mount call and required host endpoints. For a separate HTTPS host, register its exact origin and a random 32+ character server secret in `EMBED_CLIENTS_JSON`. The host server authenticates its user and requests a ten-minute session from `/api/embed/session`; the browser exchanges only that session at `/api/embed/voice-token`. The registration secret and AssemblyAI key remain server-side. Sessions are held in process memory, so use one ShowMe instance and expect a fresh host session after restart. Review the host website's CSP and use HTTPS for voice input. The host remains responsible for user authorization, validation, revision checks, and idempotent business actions.

## Boundaries before broader launch

This is an invite-only pilot, not a completed multi-tenant SaaS or a claim of formal security certification. Invitation codes are single-factor credentials; there is no email recovery, MFA, admin console, per-user role model, or catalog edit workflow. New production workspaces have empty, private customer and product catalogs; existing sample-based drafts keep their fixture records during migration. The assistant still runs tool calls in the browser, so the client can label an edit as manual or agent; the mode label is a workflow guard, not a security authorization boundary. The process-local rate limiter is intended for one instance, not distributed abuse protection. Before processing real customer invoices, add a reviewed identity provider, server-mediated agent actions, a retention policy covering backups and the provider, abuse controls at the proxy, production observability, and a real pilot validation study. Keep using synthetic customer data until those decisions are made. Docker is not installed on this development host, so the image was not verified locally. CI is configured to build it on an Ubuntu runner along with the Node checks.
