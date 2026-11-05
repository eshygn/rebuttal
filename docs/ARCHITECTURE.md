# Architecture

Rebuttal is one Next.js service. The browser polls a handful of JSON route handlers (`src/app/api/**`). Those call into `src/lib`, which owns all state (one SQLite file) and every outside call (PayPal and Gemini).

```
Browser (React, polls every 0.6–1.5 s)
   │  POST /api/disputes/:id/analyse · /approve · /sandbox · /api/demo/step
   ▼
route handlers ──► service.ts ──► ai/agent.ts ──► Gemini (via ai/model.ts chain + cache)
                       │               │
                       │               └──► rules.ts (deterministic coverage)
                       ▼
                 paypal/gateway.ts ──► live: paypal/disputes.ts, paypal/orders.ts ──► PayPal sandbox
                       │
                       └──► simulated: paypal/sim.ts (pure state machine, documented JSON)
   all of the above read and write SQLite through db.ts; every PayPal call is logged by calls.ts
```

## The five files that matter most

### 1. `src/lib/service.ts`: the orchestrator
Every user-visible action goes through here:
- open a dispute (`openScenarioDispute`);
- start an analysis (`startAnalysis`);
- approve fight, offer or accept (`approve`);
- the sandbox moves that play PayPal or the buyer (`paypalDecides`, `buyerAcceptsOffer`);
- demo controls.

It turns a decision into the right PayPal call and evidence pack, saves the new PayPal JSON, and moves the workflow stage.

**Key decisions:**
- **One function per seller action, called by both the UI and the demo director.** The scripted story and manual clicks follow the same path.
- **Preflight before opening a sandbox dispute.** PayPal's refusal (`TRANSACTION_NOT_ELIGIBLE`) hides the cause, so it looks the payment up first and puts plain-English reasons in the call log.
- **Approval is explicit.** Nothing is sent to PayPal until `approve()` runs, and the workflow refuses approval before an analysis exists.

### 2. `src/lib/paypal/gateway.ts`: the adapter between live and simulated
`runAction()` takes a dispute action with two implementations:
- a **live** call (`paypal/disputes.ts`, REST against the official schema);
- a **simulated** transition (`paypal/sim.ts`).

It goes live only for disputes that exist in the sandbox. If the sandbox refuses, it replays that single step and records why. `paypalStatus()` feeds the top-bar chip.

**Key decisions:**
- **Fallback per step, not per app.** A refused step doesn't stop the story, and it's still labelled.
- **The same response shape either way,** so nothing downstream knows or cares which path ran.
- **Disputes over plain REST.** The Server SDK has no disputes controller; Orders and Tracking do use the SDK (`paypal/orders.ts`).

### 3. `src/lib/paypal/sim.ts`: PayPal's dispute lifecycle as a pure state machine
Functions such as `simProvideEvidence(dispute, evidences, now)` return the next dispute JSON:
- statuses: `WAITING_FOR_SELLER_RESPONSE`, `UNDER_REVIEW`, `WAITING_FOR_BUYER_RESPONSE`, `RESOLVED`;
- HATEOAS links;
- offers and outcome codes.

They throw `SimError` for moves PayPal wouldn't allow.

**Key decisions:**
- **Pure functions with no I/O,** so they're easy to test (`tests/workflow.test.ts`) and deterministic for the demo.
- **Modelled on the documented shapes and the recorded fixtures.** One mapping is an assumption: an accepted offer resolves as `RESOLVED_WITH_PAYOUT`. It is logged in DECISIONS.md.
- **Paired with `src/lib/workflow.ts`,** Rebuttal's own stage machine (`new → analyzing → ready → submitted/offered → won/lost/settled/refunded`). That machine only moves forward and derives the allowed actions from PayPal's links.

### 4. `src/lib/ai/agent.ts`: the Gemini analyst
A `generateText` tool loop. The tools:
- pull PayPal data;
- read documents with vision (`ai/vision.ts`);
- run the rules table;
- submit a zod-validated recommendation.

It also writes a live trace for the UI, picks the mode (live, cached, recorded or rules-only), caches live runs, and converts the offer into money.

**Key decisions:**
- **The model reads; code computes.** Address match, tracking match and days-before-claim are computed in code and handed to the model. The model proposes an offer *percentage*; `finalise()` turns it into integer cents with `percentOf` and clamps it.
- **Structured output only:** every answer is a tool call checked against a zod schema (`ai/schemas.ts`). Length limits are applied after validation, because hard schema limits made whole runs fail.
- **Built for the free tier** (about 20 requests per model per day):
  - a model chain with per-model quota tracking (`ai/model.ts`);
  - a 10-per-minute limiter;
  - vision and whole-analysis caches;
  - replay of recorded real runs;
  - a rules-only last resort.

  Each mode is labelled in the panel and the status chip.
- **Recordings are honest.** A recorded run is never replayed once the seller has uploaded new evidence it didn't see.

### 5. `src/lib/rules.ts`: what counts as evidence
For each dispute reason, it lists the evidence that answers it, weighted critical, strong or supporting. Each item has a check against the facts (present, missing or against). `coverage()` scores them, and `baselineAction()` maps the score to fight, offer or accept. It also holds the pure helpers `addressMatches()` and `daysBetween()` (calendar days in the seller's time zone).

**Key decisions:**
- **Deterministic and explainable.** It never calls a model. The UI shows it next to the agent ("✓ Rules table agrees"), so a judge or a seller can see when the AI departs from the rules.
- **Reason-specific.** Delivery proof matters for "not received", not for "not as described". We removed a carrier-delivery rule from the not-as-described list after it skewed results.
- **Tested** with the demo's own facts (`tests/rules.test.ts`).

## Supporting pieces
- `src/lib/money.ts`: integer minor units, PayPal decimal strings (strict parsing, no silent rounding), basis-point percentages, and display with the currency.
- `src/lib/db.ts`, `seed.ts`, `scenario.ts`: the SQLite schema, seeded on first boot and on "Reset demo"; the fictional scenario.
- `src/lib/calls.ts`: every PayPal call (live or simulated) is logged to SQLite with its dispute, which drives the toasts and the API log.
- `src/lib/views.ts`: the JSON the UI reads, the demo director's next beat, and the status chips.
- `scripts/sandbox-lifecycle.ts`, `scripts/verify-tracking.ts`: live checks against the sandbox that save redacted responses as fixtures.

More detail and the full decision log: [DECISIONS.md](../DECISIONS.md).
