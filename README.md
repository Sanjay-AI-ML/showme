# ShowMe

ShowMe is a voice-first companion for completing tasks inside software. This repository contains the first host application, an invoice studio, and a separate host adapter and voice controller. Users can guide themselves, work with the assistant, delegate a supported draft task, or take over manually. The host application owns the invoice data and verifies every edit.

This is an early product foundation, not a finished commercial service. The [product plan](SHOWME_PRODUCT_PLAN.md) describes the broader product, evidence needed, and second-app milestone.

## Run locally

Requires Node.js 24 or newer, which includes the SQLite module used by the server.

```powershell
npm install
Copy-Item .env.example .env
# Edit .env and set ASSEMBLYAI_API_KEY to enable voice.
npm run dev
```

Open `http://localhost:5173`. The invoice editor works without an API key. The microphone and typed assistant turn on when a valid AssemblyAI key is present in the server environment. The key stays on the server; the browser receives a short-lived token. Never commit `.env` or a real key.

For a production-style local run:

```powershell
npm run build
npm start
```

Open `http://localhost:3001`. This is a local server, not a public deployment. The Node server persists workspace data in `data/showme.sqlite`, which is ignored by Git. Each browser gets a random private workspace cookie. The sample customer names and catalog items are synthetic.

## What works today

- Add a customer, catalog items, delivery, and payment terms; edit quantities and see a calculated preview.
- Save a draft. Manual edits to a saved draft return it to unsaved status until saved again.
- Use Guide me, Do it with me, Do it for me, or manual takeover. Guide and manual modes block agent business edits on the server.
- With an AssemblyAI key, talk to the assistant or send typed messages in the same voice session. It reads structured host state, highlights fields, explains fields, and requests bounded invoice actions.
- Agent and manual edits share revision checks. Retried action IDs are idempotent. Undo targets an agent edit and checks for later changes to the same field.

The invoice application is the first host. `client/src/host.ts` defines its integration boundary. The voice controller is in `client/src/voice.ts`; the server's authoritative invoice logic is in `server/store.ts`.

## Verification

```powershell
npm test
npm run build
```

Current automated tests cover quantity correction and totals, mode permissions, stale edit rejection, idempotency, undo with later manual work, and save validation. Voice interaction still requires a real AssemblyAI key, microphone permission, and live testing. The product has not yet been validated with end users or a second host application.

## Current limitations

The sample catalog is fixed, invoice data is synthetic, and there is no email delivery or payment flow. Workspace cookies provide isolation for a local prototype, not account login or enterprise authorization. The voice provider may process and record conversation data according to its configuration, so real customer information should not be entered into this prototype. The app currently supports one currency and English. See the plan for the product hardening and pilot roadmap.

## License

MIT. See [LICENSE](LICENSE).
