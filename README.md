# ShowMe

ShowMe is a voice-first companion for completing tasks inside software. This repository contains two working host applications: an invoice studio and a customer-profile editor. Users can guide themselves, work with the assistant, delegate a supported task, or take over manually. Each host owns its data and verifies every edit.

This is an invite-only pilot foundation, not a finished commercial service. The [product plan](SHOWME_PRODUCT_PLAN.md) describes the broader product, evidence needed, and second-app milestone. [DEPLOYMENT.md](DEPLOYMENT.md) covers the single-container production setup and its limits.

## Run locally

Requires Node.js 24 or newer, which includes the SQLite module used by the server.

```powershell
npm install
Copy-Item .env.example .env
# Edit .env and set ASSEMBLYAI_API_KEY to enable voice.
npm run dev
```

Open `http://localhost:5173` for the invoice studio, `http://localhost:5173/profile` for the customer-profile editor, or `http://localhost:5173/widget-demo` to see ShowMe mounted inside a separate customer-record UI. All manual editors work without an API key. The microphone and typed assistant turn on when a valid AssemblyAI key is present in the server environment. The key stays on the server; the browser receives a short-lived token. Never commit `.env` or a real key.

For a production-style local run:

```powershell
npm run build
npm start
```

Open `http://localhost:3001`. In local development, each browser gets an anonymous workspace cookie and synthetic sample catalog records. Production mode requires an invitation code and a server-side session; each new pilot workspace starts with an empty catalog that the pilot can fill. The Node server persists data in `data/showme.sqlite`, which is ignored by Git.

## What works today

- Add a customer, catalog items, delivery, and payment terms; edit quantities and see a calculated preview.
- Create workspace-owned customers and products with validated names, billing email, city, and INR price. New entries can be selected immediately in the draft and used by ShowMe after it reads current context.
- Save a draft. Manual edits to a saved draft return it to unsaved status until saved again.
- Use Guide me, Do it with me, Do it for me, or manual takeover. Guide and manual modes block agent business edits on the server.
- With an AssemblyAI key, talk to the assistant or start a text conversation without microphone access. Both paths use the same bounded host actions. Text-only sessions still use AssemblyAI's voice-agent service.
- Agent and manual edits share revision checks. Retried action IDs are idempotent. Undo targets an agent edit and checks for later changes to the same field.
- Invite-only pilots can export their local invoice/action data or delete their workspace from Account & data.
- Edit a customer profile manually or through ShowMe, correct a preference naturally, and undo compatible agent edits. The profile screen shows the current task step and a short change history, and ShowMe understands the focused field when asked about “this field.” Profile data has its own server actions, revision checks, and mode rules. It is included in pilot export and deletion.

Both [invoice](client/src/host.ts) and [profile](client/src/profile-host.ts) adapters use the reusable host bridge. The [embeddable widget](sdk/README.md) packages the panel, task controller, and voice transport for another website. The server's authoritative invoice and profile logic live in `server/store.ts` and `server/profile-store.ts`.

## Verification

```powershell
npm test
npm run build
npm run smoke:production
```

Automated tests cover invoice and profile behavior, workspace isolation, catalog migration, invite return and revocation. The production HTTP smoke checks origin enforcement, sign-in, catalog and profile editing, backup restoration, process restart, sign-out, export, and deletion. Voice interaction still requires a real AssemblyAI key, microphone permission, and live testing. The product has not yet been validated with end users.

With the local server running and a key configured, `npm run smoke:text` exercises an invoice text-agent session. `npm run smoke:profile-text` checks the profile adapter; `npm run smoke:widget-text` checks the reusable widget controller with a name, contact preference, and correction. These use provider minutes.

For user testing, follow [VALIDATION.md](VALIDATION.md). The app records local event counts and optional saved-draft feedback without storing conversation text in its validation table. Run `npm run validation:report` for descriptive counts; they are not task-accuracy or demand metrics.

## Current limitations

The profile editor currently manages one workspace profile; it is a second host integration, not a connected CRM. The invoice pilot can add customers and products, but there is no catalog edit workflow, email delivery, payment flow, or accounting compliance claim. Pilot invitations provide basic access control but not full identity management. The voice provider may process and record conversation data according to its configuration, so real customer information should not be entered into this pilot until provider privacy and data retention have been reviewed. The app currently supports one currency and English. See [DEPLOYMENT.md](DEPLOYMENT.md) for launch boundaries.

## License

MIT. See [LICENSE](LICENSE).
