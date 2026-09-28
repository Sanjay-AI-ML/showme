# Embed ShowMe in an existing app

## Fastest install: guidance on any website you own

Deploy ShowMe once, register your website's exact HTTPS origin in `EMBED_CLIENTS_JSON`, and add this script near the end of the website's HTML:

```html
<script defer src="https://showme.example.com/embed/showme.js"
  data-showme-name="My app"
  data-showme-session="/api/showme/session"></script>
```

This adds a floating **Ask ShowMe** launcher. The widget automatically reads the visible page title, path, headings, control labels, and alerts so it can explain the current screen by voice or text. It does not read form values, URL query strings, hidden elements, or content marked `data-showme-private`. This quick install is **guidance-only**: it cannot click buttons, submit forms, or edit data. The widget shows only Guide me and I'll take over in this mode.

To try the one-script version locally with ShowMe's existing same-origin token route, run `npm run build && npm start` and open `/page-guide-demo.html`. Its HTML uses `data-showme-token-endpoint="/api/voice-token"`; this direct-token option is only for a token route on the **same website**. A separate website should use the hosted session flow below.

The script needs one small endpoint on your website's **server**. Authenticate the visitor there, then exchange your private registration secret for a short-lived session:

```js
app.get('/api/showme/session', requireSignedInUser, async (_req, res) => {
  const response = await fetch('https://showme.example.com/api/embed/session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SHOWME_EMBED_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clientId: 'my_app' }),
  });
  if (!response.ok) return res.sendStatus(502);
  const { sessionToken } = await response.json();
  res.set('Cache-Control', 'no-store').json({ sessionToken });
});
```

Keep the secret on the server. The script is served by your ShowMe deployment, and the host page's Content Security Policy must allow that script, inline widget styles, connections to the ShowMe backend and `wss://agents.assemblyai.com`, and a Blob URL for the microphone worklet. If you use an incompatible CSP, use the SDK's `audioWorkletUrl` option for the worklet; custom stylesheet loading is not yet supported by the quick install. The website must use HTTPS for microphone access. For a site built with JavaScript modules, you can instead import `mountShowMeOnPage` from the SDK and pass the same settings.

## Add approved actions when you need edits

ShowMe provides a framework-neutral panel and a bounded voice-agent controller. Your app keeps its own UI, authentication, data, and business API. ShowMe reads a small task snapshot and calls only the actions you register. The working example is at `/widget-demo` in this repository; its source is `client/src/widget-demo.tsx`.

Build this repository with `npm run build`, then install the local package in the host app with `npm install --install-links /path/to/showme/sdk` (use the equivalent path on Windows). The flag copies the built package into the host app instead of linking to a folder outside its dev server. Reinstall after changing the SDK. The package is private and has not been published to npm.

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

Implement `GET /api/showme/session` on the **host server**. It must authenticate its own user, then make a server-to-server `POST https://showme.example.com/api/embed/session` with `Authorization: Bearer <registration secret>` and JSON `{ "clientId": "pilot_host" }`. Return only the resulting `{ "sessionToken": "..." }` to the browser. `createHostedTokenProvider` exchanges that short-lived token for an AssemblyAI voice token. Never put the registration secret or AssemblyAI key in browser code. Keep both origins on HTTPS for microphone access and configure the host page's CSP to allow `connect-src` to the ShowMe backend and `wss://agents.assemblyai.com`. The default microphone worklet is bundled as a Blob URL; allow that URL in the host CSP, or pass `audioWorkletUrl` pointing to a worklet file served from the host origin. Register the host's exact origin in `EMBED_CLIENTS_JSON`.

Hosted sessions are held in ShowMe process memory for ten minutes; they are lost on restart and are intended for one server instance. The widget code and styles are packaged together, but a real integration still requires the small host session endpoint and bounded host business endpoints. For a same-origin ShowMe installation, the demo uses its existing `/api/voice-token` endpoint directly.
