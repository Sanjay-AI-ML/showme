# Embed ShowMe in an existing app

ShowMe provides a framework-neutral panel and a bounded voice-agent controller. Your app keeps its own UI, authentication, data, and business API. ShowMe reads a small task snapshot and calls only the actions you register. The working example is at `/widget-demo` in this repository; its source is `client/src/widget-demo.tsx`.

Build this repository with `npm run build`, then install the local package in the host app with `npm install D:\AssemblyAI\sdk`. The package is private and has not been published to npm.

```ts
import { mountShowMe, createHostedTokenProvider } from '@showme/host-sdk';

const widget = mountShowMe({
  element: '#showme',
  name: 'Customer editor',
  read: () => fetch('/api/customer').then(checkJson),
  revisionOf: (state) => state.revision,
  summarize: (state) => ({ customer: state.customer, revision: state.revision }),
  tokenProvider: createHostedTokenProvider({
    backendOrigin: 'https://showme.example.com',
    sessionEndpoint: '/api/showme/session',
  }),
  actions: [{
    name: 'set_customer_name',
    description: 'Set the customer name to the exact value supplied by the user.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    run: async (args, { expectedRevision, requestId }) =>
      fetch('/api/customer/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: args.name, expectedRevision, requestId }),
      }).then(checkJson),
  }],
});

async function checkJson(response: Response) {
  if (!response.ok) throw new Error(`Host API returned ${response.status}`);
  return response.json();
}
```

The action's `run` method must return the new authoritative state with a **higher revision**. The host API must authenticate the user, validate every argument, enforce the expected revision, and deduplicate `requestId`. The schema shown to the model is guidance, not an authorization boundary. Register only the actions that this task permits; keep sensitive fields out of `summarize`. Use `fieldHelp`, `focusedField`, and `highlight` for contextual teaching; `onStateChange` to repaint the host UI; and `onModeChange` if the host API persists assistance mode. Guide and manual modes block widget edits, but the host server must enforce any security-critical policy itself.

Call `await widget.refresh()` after a manual host edit. Call `widget.reset()` whenever the signed-in user or tenant changes, then refresh; it clears cached context and rejects late responses from the previous session. Call `await widget.destroy()` when unmounting. `widget.setMode('guide' | 'collaborate' | 'delegate' | 'manual')` changes the assistance mode. You can use `createWidgetController` without the panel to build your own UI, or `createHostBridge` for lower-level state synchronization.

## Hosted voice credentials

For a website on a different origin, put a private registration in ShowMe's server environment:

```dotenv
EMBED_CLIENTS_JSON=[{"id":"pilot_host","origin":"https://pilot.example.com","secret":"replace-with-a-random-32-plus-character-secret"}]
```

Implement `GET /api/showme/session` on the **host server**. It must authenticate its own user, then make a server-to-server `POST https://showme.example.com/api/embed/session` with `Authorization: Bearer <registration secret>` and JSON `{ "clientId": "pilot_host" }`. Return only the resulting `{ "sessionToken": "..." }` to the browser. `createHostedTokenProvider` exchanges that short-lived token for an AssemblyAI voice token. Never put the registration secret or AssemblyAI key in browser code. Keep both origins on HTTPS for microphone access and configure the host page's CSP to allow `connect-src` to the ShowMe backend and `wss://agents.assemblyai.com`; its `worker-src` must allow its own bundled worklet. Register the host's exact origin in `EMBED_CLIENTS_JSON`.

Hosted sessions are held in ShowMe process memory for ten minutes; they are lost on restart and are intended for one server instance. The widget code and styles are packaged together, but a real integration still requires the small host session endpoint and bounded host business endpoints. For a same-origin ShowMe installation, the demo uses its existing `/api/voice-token` endpoint directly.
