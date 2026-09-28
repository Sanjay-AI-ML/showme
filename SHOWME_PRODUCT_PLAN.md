# ShowMe: product strategy and build plan

Research date: September 27, 2026. Status: working invite-only pilot with invoice and customer-profile hosts, shared voice transport, validated server actions, and automated production checks. User has selected ShowMe and confirmed all three experiences: guided learning, fast execution, and combined teaching/execution. The goal is a useful product and substantial portfolio project; the hackathon is the first public release milestone. Market demand and user outcomes remain hypotheses until measured.

## Current product bet

ShowMe now has two working host applications. The profile workflow tracks whether a customer name and reachable preferred contact are complete, shows a short authoritative change history, and sends the focused field to the assistant so “What does this mean?” can refer to the control the user is using. This makes the product's claim more concrete: the assistant should help a user reach a verified task outcome and recover from corrections in the actual application.

The next proof is user behavior, not another broad feature. Run five observed sessions with people unfamiliar with the app. Give each person a target profile and invoice task; record whether they finish correctly, where they ask for help, whether corrections preserve unrelated work, and whether they can repeat the task with less assistance. Compare with manual completion. Do not treat a successful agent transcript as evidence of learning or demand. A real host-company pilot still needs a workflow whose onboarding cost matters enough to justify integration.

## Product promise

**Say what you want to accomplish. ShowMe helps you do it, explains the unfamiliar parts, and keeps you in control.**

ShowMe is an embedded voice companion for business software. It shares the application's current task state, highlights relevant controls, performs requested draft edits, and lets users take over with mouse or keyboard at any time.

Initial buyer hypothesis: product and customer-success teams at small B2B software companies whose new customers need human help to complete a valuable first workflow. Initial end user: a shop owner creating their first customer invoice in unfamiliar software. Initial outcome: an accurate, saved invoice draft that the user understands and can edit themselves.

The invoicing app is the demonstration host. ShowMe is the reusable assistance layer. We must prove that separation in code and documentation before claiming an SDK product.

The durable product is a **voice-first, task-aware assistance layer for web software**. A host application registers what the user can see, what task they are trying to finish, and the actions it permits. ShowMe helps users learn, collaborate, or delegate inside that bounded area. It observes completion in the host app rather than assuming a spoken answer means the job is done.

## Research and competitive position

- Appcues already provides in-app onboarding and product-adoption experiences. [Official overview](https://docs.appcues.com/getting-started/what-is-appcues)
- Amplitude Guides and Surveys provides tours, checklists, and other contextual guidance; its site describes its relationship to the acquired Command AI product. [Official product page](https://amplitude.com/guides-and-surveys)
- Pillar is a particularly close competitor: its open-source copilot supports app actions, contextual answers, and interactive confirmation cards. An assistant executing app actions is therefore not a sufficient originality claim. [Official repository](https://github.com/pillarhq/pillar)

Our proposed distinction is the combination of conversational teaching, visible action, manual handoff, and reliable correction. This is positioning to validate, not proof that competitors lack these capabilities. Do not pitch ShowMe as the first product copilot or as universally compatible with every website.

The hardest commercial question: does assistance fix a meaningful adoption problem, or does the host app simply need a better interface? Test with workflows where explanation and context are genuinely useful. A single obvious form is a weak demonstration.

Research supports making user agency a first-class design constraint. A 2026 [Google Research GUI assistance benchmark](https://research.google/pubs/guide-a-benchmark-for-user-context-understanding-and-assistance-in-gui-workflow-videos/) found that understanding a user's state and deciding when to help remain difficult. This does not establish ShowMe's effectiveness; it argues for using explicit host state and measuring help decisions. [Appcues' current onboarding guidance](https://docs.appcues.com/checklists/checklist-best-practices) recommends activation goals based on actual completed actions, and prompts learning by doing. ShowMe should measure successful task completion and later independent use, not conversation count or tour views.

### Market entry and target task

First market: B2B products with multi-step setup or operational workflows and an engineering team able to expose structured actions. The buyer is likely a product, growth, or customer-success lead; the daily user is the software customer. Start with providers that can name one costly adoption bottleneck. Invoicing is a representative wedge, but if interviews show that another workflow has stronger need, retain the ShowMe platform and change the first vertical.

Good pilot candidates: invoice setup, CRM lead qualification and pipeline setup, analytics dashboard creation, or permissions setup. Avoid regulated or irreversible workflows at the start. A real pilot needs a host team willing to instrument their app and share completion events. The product should support text and manual guidance when speaking is inconvenient.

Competitive advantage to earn, not assume: ShowMe is useful when users need different levels of help on the same task, and it can prove both correct completion and independent repeat use. Embedded action execution itself is already available from competitors.

### The feature that makes the project substantive

ShowMe should remember **task progress within the host application**, not merely conversation history. A task definition states what success means and which intermediate conditions matter. If the user asks for help, ShowMe chooses the least intervention that is likely to unblock them: a short answer, a field highlight, a guided step, or a requested action. After the first successful completion, it can offer a lighter touch on the next attempt. The user controls assistance mode explicitly; adaptive help never silently removes their ability to guide or delegate.

This creates a testable claim: users finish the current job correctly *and* can repeat it with less help. We should compare that outcome with a conventional guide and with fast automation. If faster execution reduces learning, report the tradeoff instead of hiding it.

## Signature experience

Three assistance modes plus manual takeover share the same task and application state:

| Mode | Agent behavior | User remains responsible for |
| --- | --- | --- |
| Guide me | Highlights the next control, gives one short explanation, and waits for the actual UI change | Making the edit |
| Do it with me | Applies requested reversible draft changes and explains useful details | Supplying missing information and reviewing the result |
| Do it for me | Executes the supported requested task with minimal narration; asks only necessary questions | Resolving ambiguity and reviewing the result |
| Let me take over | Stops proposing changes and watches for the next request | Working directly in the application |

Default: Do it with me. Mode switches must work by visible control; spoken switches are also supported. Avoid inferring competence or proficiency from accent, hesitation, or speaking style.

Key moments:

1. The user names an outcome instead of a sequence of clicks.
2. The agent handles missing information without interrogating them about already known fields.
3. The user points to a field and asks, "What does this mean?"
4. The user interrupts with a correction, and the correct row changes visibly.
5. The user manually edits a value, and the agent uses that new value on the next turn.
6. The user undoes a change without losing unrelated work.
7. The agent verifies the saved result before saying it succeeded.

## First release and hackathon scope

Build one small but coherent invoice application: customer selection, item catalog, invoice editor, and draft preview. Seed synthetic customers and products. Support one currency (INR) and English initially. Tax is a labeled fixture setting, not a jurisdiction-aware tax engine. Do not imply accounting compliance.

Five business actions:

1. Select an existing customer.
2. Add, update, or remove an item using stable product and row IDs.
3. Set a separate delivery charge.
4. Set supported payment terms and derive the due date from the explicit issue date.
5. Validate, preview, and save an invoice draft.

Supporting controls: read current context, highlight a registered field, explain a supported field, switch mode, and undo a reversible agent change. Separate these from business actions in implementation. Expose only a small relevant set at each workflow phase.

Necessary features: real microphone interaction, captions, keyboard/manual completion, reliable state synchronization, visible changes, undo, persistence, session reset, actionable failure messages, and a deployed HTTPS URL.

Stretch after reliability gates pass: a compact session outcome view and a second minimal host adapter (for example, a customer profile editor) to demonstrate reuse. The second adapter is not a second full application.

Deferred from the first release: arbitrary website control, browser extension, screenshot-based automation, autonomous sending, payments, real customer data, multi-language promises, a marketplace, and a large administration dashboard. These are sequencing choices, not permanent limits on the product.

This release has two separate claims. The invoice application proves the end-user experience. A host adapter proves that the assistance layer has a clean integration boundary. Only a second independently built workflow can establish that ShowMe actually generalizes beyond invoices.

## Demo script

Use synthetic data: Sunrise Studio, chair unit price INR 2,500, delivery INR 500. No tax in this fixture. Frozen demo issue date September 27, 2026.

| Step | User | Observable result |
| --- | --- | --- |
| Goal | "Create a draft invoice for Sunrise Studio: twelve chairs, with delivery separate." | Resolves customer and product; asks delivery amount because it was not supplied |
| Complete | "Five hundred rupees." | Twelve chairs plus delivery; total INR 30,500 |
| Correct | "Actually, ten chairs." | Same row changes from twelve to ten; total INR 25,500 |
| Learn | Selects payment terms and asks "What does this mean?" | Highlights selected field and explains how it sets the due date |
| Guide | "Show me how to make it due in fifteen days." | Guides the user; user selects Net 15; due date becomes October 12 |
| Handoff | User manually changes delivery to INR 700 | State updates; next agent response uses total INR 25,700 |
| Recover | "Remove delivery." followed by "Undo that." | Restores delivery to INR 700 without undoing the manual payment-term choice |
| Finish | "Save the draft." | Validates, persists once, and displays the returned draft ID and preview |

The required demo is about three minutes. Include the correction and manual handoff even if other material must be cut. Judges should be able to change quantities and customers themselves; the script must not trigger prerecorded behavior.

No real invoice delivery in the MVP. If a later demo outbox is added, label it as simulated and bind its confirmation to the exact recipient, amount, and invoice revision.

## Screen awareness and architecture

Use an instrumented host application. The app exposes selected, structured state through a small adapter; the model does not infer its state from screenshots.

Context includes route, current record ID, revision, active field, selected row, editable values, validation errors, available actions, user mode, and recent applied changes. Stable UI target IDs connect explanations and highlights to actual controls. An ambiguous "this" triggers a short clarification when no selected or focused target resolves it.

```text
Microphone -> AssemblyAI Voice Agent API -> proposed tool call
                    ^                           |
                    |                           v
             compact context             ShowMe controller
                    ^                 validates mode and intent
                    |                 checks revision and permissions
                    |                           |
Host UI <------ canonical application state <--- action service
                    |
            committed action receipt -> grounded spoken response
```

Recommended implementation: TypeScript frontend and lightweight Node backend; ordinary React components for the host; a separate ShowMe controller and host adapter; a transactional persistent store supported by the chosen deployment. Final hosting and storage selection belongs in implementation setup.

For a serious product, keep the host adapter small and explicit. It should register task definitions with completion predicates, a typed state reader with permitted fields, anchored UI targets, available actions with parameter schemas, mutation handlers, confirmation requirements, and application events. The ShowMe controller must not reach into arbitrary host components or click guessed DOM selectors. The same adapter should be usable from a React app and, later, from a framework-neutral JavaScript wrapper. One conceptual integration might be `registerTask`, `getContext`, `registerAction`, `onHostChange`, and `resolveTarget`; exact names can change during implementation.

Store conversation/session metadata separately from host business records. For a multi-tenant version, issue tenant-scoped session tokens, apply server-side record authorization to every action, and emit only the host fields that are needed for the active task. The model receives a capability-limited context snapshot; it never becomes the authority for host permissions.

Both manual controls and agent tools use the same validated mutation service. Currency calculations use integer minor units. The LLM never calculates authoritative totals, invents prices, or directly writes arbitrary fields.

Backend owns record revision and session ownership. Client owns highlighting, focus, audio playback, and provisional UI. A successful action returns an authoritative receipt: action ID, draft ID, old/new revision, changed values, total, and status. Only this receipt can support a success claim.

Every mutation carries an expected revision and an idempotency identifier. Reject stale changes and refresh context instead of overwriting a newer manual edit. Persist idempotency receipts for the session so reconnects and retries cannot duplicate actions.

Undo uses a recorded inverse patch with conflict checks. If the user changed the same field afterwards, explain the conflict and ask which value to retain. Never restore an entire old form snapshot over newer work.

## AssemblyAI integration findings

The current API supports managed speech interaction and function tools. Use that path first and prove microphone-to-tool-to-UI behavior before polishing. [API overview](https://www.assemblyai.com/docs/voice-agents/voice-agent-api)

Client tools suit local focus and UI state. Tool parameters use JSON Schema; validate them again in our application. Results must follow the documented event timing. Treat interruption as a separate action-lifecycle problem: discarding a pending voice result does not undo a committed application change. [Client tools](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/tools/client-side-tools)

The events reference provides context messages that do not automatically trigger speech. Use bounded state summaries after material app changes, with a fresh state read before sensitive mutations. [Events reference](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/events-reference)

Mint temporary browser tokens on the server. Test the documented capture/playback path on the actual demo browser, including sample-rate conversion. [Browser integration](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration)

Research surfaced older and newer documentation variants with different example fields and model labels. Resolve payloads against current reference pages and a live integration test. Do not copy old snippets blindly or promise exact recognition latency.

## Action and interruption policy

An explicit user request authorizes the related reversible draft edit in Do it with me or Do it for me mode. Fast execution changes the amount of explanation, not the validation or permission rules. No confirmation for every field. Guide me mode must never mutate business data. Ambiguous entities, amounts, or targets require clarification, not guessed execution.

Track actions as proposed, validated, committing, committed, rejected, or cancelled. New speech pauses not-yet-committed action dispatch until intent resolves. A committed edit is not automatically rolled back merely because the user began speaking. "Undo" requests a compensating edit; "stop" cancels remaining work and states what already completed.

The visible Stop control immediately stops playback and new dispatch. Voice interruption depends on event delivery and recognition, so measure it rather than promise an instantaneous stop. Late tool responses may be excluded from the old spoken turn, but their action receipts remain in the ledger and fresh context must reflect any committed change.

Do not treat LLM-generated booleans such as approved=true as authorization for external actions. Future sending would require application-held confirmation of an exact proposal, invalidated by subsequent edits. Draft saving is reversible and can follow a direct spoken request.

## Risks, controls, and proof

| Risk | Design response | Required evidence |
| --- | --- | --- |
| Generic assistant | Teach/do handoff, field pointing, correction and undo form the core story | Live demo includes all four |
| Existing competition | Narrow differentiated behavior and measurable user outcome | Honest competitor comparison; no uniqueness claim |
| Wrong number or customer | Show recognized values; resolve candidates; clarify ambiguity; enforce bounds | Confusable quantities, duplicate names, missing delivery amount |
| Stale screen context | Revision-checked mutations and manual-change events | Manual edit during delayed tool call survives |
| Interrupted action still executes | Dispatch gate plus action ledger and explicit compensation | Interrupt before and after commit; verify actual final state |
| Duplicate action on retry | Idempotent mutation service and persistent receipts | Replayed call creates only one result |
| Undo destroys manual work | Field-level inverse and conflict detection | Manual edits outside changed fields remain intact |
| Fabricated completion | Receipt-grounded speech and honest error UI | Failed save never displays or claims success |
| Prompt injection in app content | Customer names/notes are untrusted data; action allowlist and server ownership checks | Malicious note cannot unlock an action or another session's data |
| Too much talking | One useful explanation at a time; no narration of every keystroke | Observe novice users and count unnecessary turns |
| Mic/network failure | Manual controls remain functional; reconnect preserves draft and revisions | Denied mic, dropped socket, refresh and reconnect |
| Privacy misunderstanding | Synthetic demo data; disclose cloud voice processing | Inspect network/log contents and vendor recording settings |
| Integration burden | Explicit adapter contract; narrow supported workflow | Record actual integration effort; optional second adapter |
| No customer demand | Interview likely buyers and observe novice users | Real notes and willingness-to-pilot evidence |

Audio is processed by AssemblyAI. Do not call this local-only or claim zero retention. Confirm provider recording and retention settings before a real-data pilot. Keep unnecessary full transcripts out of our own application logs. Rate-limit token issuance and cap demo session duration.

## Evaluation plan

Proposed targets, not measured results:

- 30 scripted state/action cases: ambiguity, valid edits, corrections, guide mode, focus, interruptions, undo, retries, reconnect, persistence failures, and session isolation.
- Zero unauthorized sends (no send capability in MVP), zero duplicate saves, zero stale overwrites, and zero business mutations in Guide me mode in the test suite.
- At least 18 of 20 live varied-utterance sessions complete the supported task with correct final data. Report denominator, failures, and test conditions.
- Measure end-of-utterance to visible update and end-of-utterance to first audible reply separately. Initial median target below 2.5 seconds; report p95, not just best case. Revisit after the integration spike.
- Verify Stop-button dispatch cancellation and measure audible interruption tail on the actual browser and network.
- Observe 5-8 novice users if available. Counterbalance manual and assisted task order with different equivalent invoices. Measure correct completion, time, interventions, and a follow-up task without assistance. Small sample findings are exploratory, not statistically proven business impact.

## Business and economics

Value hypothesis: help software vendors improve correct first-task completion and reduce repetitive onboarding assistance. Sell to the software vendor, while the shop owner uses the embedded experience. Start with one workflow per pilot so the outcome is attributable.

Vendor interviews should establish the troublesome task, current completion rate if known, staff assistance time, action API availability, engineering integration budget, and willingness to run a measured pilot. Do not fabricate TAM, support savings, or conversion uplift.

AssemblyAI currently lists the Voice Agent API at USD 0.075 per connected minute, billed by connected time. A three-minute session is approximately USD 0.225; 100 such sessions are USD 22.50 before hosting and other costs or credits. [Official pricing](https://www.assemblyai.com/pricing)

End inactive sessions and provide an explicit reconnect action. Proposed commercial model after validation: a platform fee with included voice minutes and usage overage. Do not choose a sell price until actual support, integration, and usage costs are measured.

### Product proof beyond a hackathon

The next evidence is a real host integration or a credible independent second sample application. Report integration time honestly, including action wiring and task documentation. Conduct pilot interviews with at least five teams in the target buyer role and seek one design partner with an identifiable painful workflow. Counts are recruiting targets, not evidence that interest exists.

Instrument a task funnel: assistance offered, accepted, mode switches, task completed correctly, task abandoned, correction/undo, manual takeover, and independent repeat completion. Compare assisted and unassisted sessions where possible. Avoid claiming uplift from synthetic seeded users. A voice session that ends happily while the underlying task is wrong is a product failure.

For a useful portfolio project, publish an architecture diagram, SDK/adapter contract, a second sample integration, an interactive hosted app, reproducible evaluation cases, latency and accuracy results, a failure analysis, and a short technical write-up explaining tradeoffs. Link to live code and a demo that allows unprepared inputs. The strongest resume statement will report measured outcomes, such as completion rate or integration time, with sample size and conditions. Until those are measured, describe shipped capabilities rather than invented impact.

## Build sequence and decision gates

1. September 27: freeze workflow and prove live voice, one context read, one reversible edit, interruption, and tool-result timing. If the managed API is unavailable, evaluate AssemblyAI realtime STT with separate orchestration immediately; this adds risk and requires scope reduction.
2. September 28: finish the canonical invoice model, five actions, mode controls, field highlights, manual synchronization, undo, and persistence. Deploy an early working version.
3. September 29: run failure tests and live sessions, fix errors, observe users if available, then record a working demo. Add stretch scope only if core gates pass.
4. September 30: verify public URL in a fresh session, complete repository/license/README, cover, slides, and video. Target upload by 5:30 PM IST for the stated 8:30 PM deadline. Recheck the event page before submission.

If behind schedule, cut the second adapter, analytics, extra invoice settings, and visual flourishes first. Preserve correction, manual handoff, accurate calculations, and honest persistence. Without live voice and demonstrable state changes, the core promise is not delivered.

Pitch: **ShowMe helps users complete their first real task in unfamiliar software through a conversation that can explain, act, and hand control back at any moment.** The demo should prove that promise with an interruption, a manual edit, and a correctly saved result.

## Product roadmap after the September submission

**Phase 1 — Product foundation (first two weeks after submission):** Separate the voice transport, task controller, host adapter, and sample invoice app into clear packages. Make the public demo dependable across refreshes and browsers. Add a documented integration example, seeded test data, and instrumentation. Publish the architecture and honest evaluation baseline.

**Phase 2 — Generalization (following two to four weeks):** Build a second workflow in an independently structured application, preferably CRM or analytics rather than another invoice form. Integrate through the documented adapter without editing ShowMe core for app-specific business rules. Any core changes required become explicit product learnings. Add text input and keyboard access alongside voice.

Phase 2 exit criteria: both apps use the same published integration contract; each exposes at least one multi-step task, Guide me and Do it for me work in both, manual changes remain visible to the controller, and a fresh developer can follow the integration guide without private instructions. Report actual integration time and defects.

**Phase 3 — Real pilot:** Work with a willing software team on one high-friction task. Add tenant isolation, per-action permission policies, operational monitoring, retention controls, and billing boundaries appropriate to their data. Compare correct completion, time, support intervention, and independent repeat use against their existing experience. Ship only after these have real evidence.

**Phase 4 — Expansion based on evidence:** Decide whether to pursue developer SDK distribution, a managed service, or direct integration work. Prioritize the feature that removes the actual pilot bottleneck, such as no-code task authoring, multilingual speech, accessibility, or deployment controls. Avoid investing in generic browser automation unless the chosen customers truly require it and accuracy can be demonstrated.

The key product gate is a second app plus a real user study. A polished invoice demo proves the experience is possible; it cannot by itself establish reusable product value.
