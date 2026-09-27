# ShowMe validation protocol

ShowMe has a working local invoice workflow. Product validation requires observed users and a potential buyer; successful API calls and automated tests alone do not establish demand or usefulness.

## Run five to eight novice sessions

Use only the synthetic customers and products in the app. Ask each participant for permission to observe their session. Start each task in a fresh browser profile or after clearing the ShowMe site data. Do not enter real customer information or record private speech. Keep the facilitator silent except when the participant is stuck; count each intervention.

Give participants two equivalent tasks, one manually and one with ShowMe. Alternate the order across participants. Start a timer when the task is read, and stop when they say it is complete. Inspect the saved invoice rather than judging success from the agent's words.

| Task | Participant request | Correct saved result |
| --- | --- | --- |
| A | Invoice Sunrise Studio for twelve oak chairs, delivery ₹500, Net 15. After the first quantity appears, change it to ten chairs. | Sunrise Studio; ten oak chairs; delivery ₹500; Net 15; total ₹25,500; saved draft. |
| B | Invoice Atlas Workspace for four studio tables, delivery ₹600, Net 15. After the first quantity appears, change it to three tables. | Atlas Workspace; three studio tables; delivery ₹600; Net 15; total ₹24,000; saved draft. |

For the assisted task, also ask them to click a field and ask what it means, change one value manually, and ask ShowMe to continue. Test Guide me and Do it for me with at least one participant each. Check that Guide me never changes business data. If the agent makes a wrong edit, allow the participant to correct or undo it; record the failure and recovery separately.

For each task, record: participant code (not name), task and condition, correct saved result (yes/no), time, facilitator interventions, wrong edits, successful corrections, manual handoffs, and any quote the participant explicitly permits you to retain. Afterward ask what was confusing, whether they could repeat the task alone, and whether they would choose assistance next time. Do not lead them toward a positive answer.

`npm run validation:report` shows local counts of voice/text sessions, turns, assistant errors, saved drafts, agent edits, and optional feedback. It stores no message text. Counts include any prior development activity in the same local database; use a clean database or label the report as mixed development data before drawing conclusions.

## Buyer validation

Interview at least five product or customer-success teams at software companies. Ask for a real onboarding task with low completion or high support burden, its current baseline if known, available action APIs, privacy constraints, and whether they would run a measured pilot. Seek one design partner willing to provide a test environment and a named owner. Interest without a pilot commitment is not commercial validation.

The first evidence gate is five observed novice sessions with task-state checks and a written failure analysis. The second is a second host application integrated through the same adapter. The third is a design partner running a real measured pilot. Until then, describe ShowMe as a working prototype under evaluation.
