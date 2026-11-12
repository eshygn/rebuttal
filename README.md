# Rebuttal

**Win the PayPal disputes worth winning, settle the rest in minutes.**

When a buyer opens a PayPal dispute, the money freezes and a deadline starts. Most small sellers either give up or send a weak reply, because collecting the right proof for each dispute reason takes hours. PayPal's Agent Toolkit can list and read disputes, but its only dispute action is accepting the claim, which means giving up.

Rebuttal works the other side. For each dispute it pulls the dispute, the original payment, the PayPal tracking record and the seller's own evidence. Gemini reads the carrier screenshot or PDF, which PayPal's tracking API never sees, and a fixed rules table shows what each dispute reason needs, what is on file and what is missing. An agent then recommends one action with its reasons:

- **fight**: build the evidence pack and draft the response;
- **offer**: propose a partial refund;
- **accept**: refund in full, when fighting would lose.

The seller approves, Rebuttal submits through the PayPal Disputes API, and the inbox counts down every deadline.

Built for small online sellers who take PayPal: independent shops, marketplace sellers and small Shopify stores.

---

## Judge quickstart

**Hosted demo:** not deployed yet. `render.yaml` is ready for Render's free plan (first load there can take about a minute to wake). Until then, run it locally with the one command below.

**Run it locally in mock mode (no keys needed):**

```bash
npm install && npm run dev
```

Open http://localhost:3000 and press **Next →** in the dark dock at the bottom. The story takes under three minutes. In mock mode the agent's answers are replays of recorded real Gemini runs, so the numbers below are what you will see:

1. Jordan Reyes opens an *item not received* dispute for $84.00 USD. PayPal freezes the money.
2. **Build my case**: the agent pulls the dispute, the payment and the tracking record, reads the carrier screenshot (delivered 5 Nov to the PayPal address, two days before the claim) and checks the rules table → **FIGHT**.
3. Approve: the evidence pack goes out through `provide-evidence`.
4. Jump 3 days: the sandbox step that plays PayPal rules for the seller → **Won, $84.00 USD released**.
5. Priya Natarajan opens a *not as described* dispute: the bowl is lighter than the listing photo. Gemini compares the photos and the rules show mixed evidence → **OFFER** a partial refund (40% in the recorded run).
6. Approve: `make-offer` goes out. Jump 1 day: the sandbox step that plays the buyer accepts → **Settled, $39.00 USD kept**, no return.

With a Gemini key the agent runs live, and its offer percentage can differ between runs. A live run on 5 Nov 2026 chose 30% ($45.50 USD kept).

Every PayPal call pops up as a toast labelled **LIVE** (sent to the PayPal sandbox) or **SIMULATED** (replayed in PayPal's documented response shape). **API log** shows the full request and response JSON. **Reset demo** starts over; the demo clock in the top bar moves deadlines forward.

Requirements: Node 20.9 or newer. Mock mode makes no calls to PayPal or Gemini (Next.js does download its Google Fonts on first run). To force mock mode when keys are present in your environment, set `REBUTTAL_MOCK=1`.

---

## Real vs simulated

"Real" means the call went to PayPal's sandbox or to Google's Gemini API. "Simulated" means Rebuttal replayed it from its built-in simulator or from a recorded earlier response. The screen always labels which one you're seeing.

**Read this first: the current status (12 Nov 2026).**
- **PayPal:** the current sandbox app works.
  - Real: login, the shop creating orders, card capture and adding tracking (`scripts/verify-tracking.ts`).
  - Still simulated: every **dispute** step. A buyer payment to this app's seller account now exists, but PayPal won't let the app open the dispute as the buyer until the buyer's one-time consent ("Log in with PayPal") takes effect.
- **Gemini:** the current key works.
  - In the live run, the newest Flash model (`gemini-3.8-flash`) was skipped and `gemini-3.5-flash` answered both disputes. The top bar showed `AI: Gemini live · gemini-3.5-flash`.
  - Live answers vary between runs: this run offered 20% on the bowl ($52.00 USD kept), while the recorded run offered 40%.

Details in [DECISIONS.md](DECISIONS.md).

| Part | Live? | Notes |
| --- | --- | --- |
| Gemini agent: tool loop, carrier screenshot/PDF reading, photo comparison | **Real** when a model answers (verified 12 Nov) | Order: newest Flash (`gemini-3.8-flash`), then `gemini-3.5-flash`, then recorded responses. The top bar names the model in use, or says "recorded responses" and why. |
| PayPal OAuth, Orders v2 create, card capture, order **tracking** | **Real** (verified 12 Nov) | `scripts/verify-tracking.ts` captures a test-card payment and adds a tracker (201). The shop's `POST /v2/checkout/orders` also ran live. |
| PayPal JS SDK Smart Buttons on `/shop` | **Real** (renders; verified 4–5 Nov) | A full buyer checkout through the buttons needs a sandbox buyer login, which we haven't had, so it is untested. |
| Disputes: create as buyer | **Reached, refused** | Every attempt so far was refused before a dispute existed. 4 Nov: the payment was still pending and the buyer email was the seller's. 12 Nov: a completed $84.00 USD payment from the buyer to the seller exists, but PayPal refused the buyer identity header ("No permissions to set target_client_id") because the buyer hasn't yet given the app consent. |
| Disputes: show, provide-evidence, make-offer, accept-claim, adjudicate, accept-offer | **Simulated** | Written against the official schema and wired to go live for any dispute that exists in the sandbox. None has run live, because no dispute could be created. |
| Disputes: list | **Not used** | The client function exists (`listDisputes`) and a manual call returned an empty list. The app does not poll PayPal for new disputes; its inbox comes from the demo scenario and from disputes it opens itself. |

**Only works in mock mode, today:** the whole dispute story. Even with working PayPal credentials, every dispute call shows **SIMULATED** until you set a sandbox transaction ID that PayPal accepts (see below).

---

## How PayPal is used

| Moment | PayPal API | Code |
| --- | --- | --- |
| Buyer pays in the seller's shop | **JS SDK Smart Buttons** → server `POST /v2/checkout/orders`, `POST /v2/checkout/orders/{id}/capture` (**Server SDK** `OrdersController`) | `src/components/PayPalButton.tsx`, `src/lib/shop.ts`, `src/lib/paypal/orders.ts` |
| Seller ships | `POST /v2/checkout/orders/{id}/track` (**Tracking**, Server SDK `createOrderTracking`) | `src/lib/shop.ts`, `scripts/verify-tracking.ts` |
| A dispute arrives | `GET /v2/payments/captures/{id}` (preflight), then `POST /v1/customer/disputes` with `PayPal-Auth-Assertion` for the sandbox buyer *(sandbox only)* | `src/lib/paypal/preflight.ts`, `src/lib/service.ts` |
| Agent pulls the case | `GET /v1/customer/disputes/{id}`, `GET /v2/checkout/orders/{id}` (incl. `shipping.trackers`) | `src/lib/ai/agent.ts` |
| Seller fights | `POST /v1/customer/disputes/{id}/provide-evidence` (multipart: `input` JSON with `PROOF_OF_FULFILLMENT` + tracking info, `evidence_file` attachments) | `src/lib/service.ts` |
| Seller offers | `POST /v1/customer/disputes/{id}/make-offer` (`offer_type: REFUND`, amount from integer minor units) | `src/lib/service.ts` |
| Seller accepts | `POST /v1/customer/disputes/{id}/accept-claim` | `src/lib/service.ts` |
| PayPal decides | `POST /v1/customer/disputes/{id}/adjudicate` *(sandbox only)* | `src/lib/service.ts` |
| Buyer responds | `POST /v1/customer/disputes/{id}/accept-offer` with buyer assertion *(sandbox only)* | `src/lib/service.ts` |
| Lifecycle script only | `escalate`, `require-evidence` *(sandbox only)* when a dispute stalls in the inquiry stage | `scripts/sandbox-lifecycle.ts`, `src/lib/paypal/disputes.ts` |

Rebuttal follows PayPal's HATEOAS links (the links each API response carries to the actions allowed next): the action buttons it offers are the ones the dispute's `links` allow.

**Live vs simulated.** One adapter (`src/lib/paypal/gateway.ts`) has a live implementation and a simulated one for every dispute action. A dispute that exists in the PayPal sandbox goes live. A step the sandbox refuses or cannot reach is replayed by `src/lib/paypal/sim.ts`, a tested state machine that emits PayPal's documented JSON, and the UI says **SIMULATED** with the reason. The top-bar chip shows the PayPal mode, with ⚠ if the sandbox buyer email is misconfigured.

### The sandbox lifecycle script

```bash
npx tsx scripts/sandbox-lifecycle.ts <BUYER_TRANSACTION_ID>
```

This runs one *item not received* dispute through the sandbox lifecycle: create as buyer → read as seller → provide evidence → under review → adjudicate for the seller → confirm `RESOLVED / RESOLVED_SELLER_FAVOUR`.

- It first looks the payment up and prints plain-English reasons if it can't be disputed.
- It saves real responses (emails and merchant IDs redacted) to `fixtures/paypal/`.
- It prints each step as `LIVE` or `SIMULATED`.
- It exits with code 2 if nothing ran live.
- With `--replay`, or with no ID, it replays the fixtures with no network access.

The step fixtures in `fixtures/paypal/lifecycle/` are still documented samples, because no live run has got past step 1. `manifest.json` says which is which.

## How AI is used

Rebuttal's analyst is a **Gemini tool-calling agent** (Vercel AI SDK 7, `@ai-sdk/google`):

```
get_dispute ──────────┐
get_transaction ──────┤  PayPal APIs (or their simulator)
get_tracking_record ──┘
list_seller_evidence
read_carrier_document ── Gemini vision → CarrierScan (zod)   status, delivery time, address, scans
compare_photos ───────── Gemini vision → PhotoComparison (zod)
check_evidence_coverage ─ deterministic rules table, no AI
submit_recommendation ─── Recommendation (zod): action, confidence, reasons, offer %, draft response
```

- **It reads what PayPal can't see.** PayPal's tracker stores only `{capture id}-{tracking number}` and a status (`SHIPPED`). We confirmed this against the live sandbox. Gemini reads the carrier's own screenshot or PDF and extracts the status, delivery time, delivery address and scan history. The UI shows "What PayPal's tracking API knows" next to "What the carrier says".
- **The rules decide what counts.** `src/lib/rules.ts` maps each dispute reason to the evidence that answers it (critical / strong / supporting) and gives a baseline action. The screen shows whether the agent agrees ("✓ Rules table agrees").
- **Code does the facts and the money.** Address matching, tracking-number matching and "days between delivery and claim" are computed in code and handed to the model. The model proposes an offer *percentage*; the server converts it to integer minor units and clamps it below the disputed amount.
- **Structured, validated output only.** Every model output is a tool call validated by a zod schema. Nothing is parsed from free text.
- **Fallback order.** Gemini's newest Flash model (`gemini-3.8-flash`), then `gemini-3.5-flash`, then **recorded responses** (real Gemini runs saved earlier in `src/lib/ai/recorded/`).
  - A model moves on to the next step when it's overloaded (503), out of quota (429) or not offered to your key (404).
  - The top bar shows `AI: Gemini live · <model>`, or `AI: recorded responses (Gemini unavailable)` with the reason on hover, and the agent panel says the same.
  - `AI_MODEL` replaces the first model and `AI_FALLBACK_MODEL` the second. (`gemini-2.5-flash` was the first choice for the second step, but new Gemini keys get a 404 from it.)
  - If there's no recording either (for example after uploading new evidence), the rules table decides and the result is labelled "Rules only".
- **Free-tier aware.** Requests are capped at 10 per minute, and vision reads and whole analyses are cached, so a demo reset doesn't spend quota.
- **Live runs can be slow.** When the first model is busy, an analysis can take a minute or more before it falls back.

## Run with live sandbox keys

1. Copy `.env.example` to `.env` and fill in:
   - `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: a **sandbox** REST app (developer.paypal.com → Apps & Credentials).
   - `PAYPAL_SANDBOX_BUYER_EMAIL`: your sandbox **personal** account (it ends in `@personal.example.com`). Using the business account here is the most common mistake; the PayPal chip shows ⚠ if you do. The buyer-side sandbox calls need the `disputes/create` scope on the app and the buyer's consent (see PayPal's *Set up buyer-side credentials* page).
   - `GOOGLE_GENERATIVE_AI_API_KEY`: from Google AI Studio. `AI_MODEL` and `AI_FALLBACK_MODEL` are optional (see "Fallback order" above).
2. `npm run dev`. The chips should read **PayPal: sandbox live** and **AI: Gemini live**.
3. To run the story on real sandbox disputes, you need payments the sandbox buyer made from their own PayPal account (PayPal won't let a buyer dispute anyone else's payment):
   - log in to sandbox.paypal.com as the sandbox **personal** account and pay the **business account that owns the REST app** (not the other way round): **$84.00 USD** for the INR story and **$65.00 USD** for the SNAD story;
   - wait until the payment shows as completed, then copy each **buyer-side transaction ID** into `SANDBOX_INR_TRANSACTION_ID` and `SANDBOX_SNAD_TRANSACTION_ID`;
   - restart. "A buyer opens a dispute" now tries a real sandbox dispute. If PayPal refuses, the call log says why (payment not completed, buyer email is the seller, buyer consent missing) and the story continues simulated.
4. Optional: `npx tsx scripts/verify-tracking.ts` checks the Tracking API, and `npx tsx scripts/record-ai.ts` re-records the Gemini fallback runs (about 15 requests of free-tier quota).

### Deploy

`render.yaml` is a Render Blueprint for one free web service (`npm ci && npm run build`, `npm start`). Add the keys as environment variables, or leave them empty for mock mode. SQLite lives on the instance disk and is re-seeded on boot. It has not been deployed yet.

**Before deploying with real keys, note that there is no login.** Anyone with the URL can reset the demo, trigger sandbox calls with your app's credentials and spend your Gemini quota. For a public judge link, mock mode (no keys) is the safe choice.

## Development

```bash
npm run dev         # http://localhost:3000
npm run lint
npm run typecheck
npm test            # 38 vitest tests: money maths, both state machines, preflight, rules, AI schemas, the full demo story
npm run build
```

```
src/
  app/                    Next.js App Router pages and route handlers (/api/...)
  components/             UI: workspace, dispute detail, agent trace, shop, PayPal button
  lib/
    paypal/               disputes REST client, Orders/Tracking via Server SDK, preflight, sandbox simulator, gateway
    ai/                   agent, vision readers, zod schemas, model chain + cache, recorded runs
    rules.ts              the dispute-reason → evidence rules table
    workflow.ts           Rebuttal's dispute state machine
    money.ts              integer minor units, PayPal decimal strings, formatting
    scenario.ts, seed.ts  the fictional demo scenario
scripts/                  sandbox-lifecycle.ts, verify-tracking.ts, record-ai.ts, render-evidence.ts
fixtures/paypal/          recorded and documented PayPal responses
tests/                    vitest
docs/ARCHITECTURE.md      the five files that matter most
```

Money is held as integer minor units everywhere and always shown with its currency. All people and businesses in the demo are fictional.

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [DEMO.md](DEMO.md) (video script), [SUBMISSION.md](SUBMISSION.md) (Devpost text), [DECISIONS.md](DECISIONS.md) (what we chose and why), [LEARN.md](LEARN.md) (beginner walkthrough).

MIT licensed.
