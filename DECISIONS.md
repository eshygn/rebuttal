# Decisions

Choices made while building Rebuttal, and why. Newest at the bottom of each section.

## PayPal

**The Disputes API is called over REST, not through the Server SDK.**
`@paypal/paypal-server-sdk` 2.5.0 ships controllers for Orders, Payments, Vault, Subscriptions and Transaction Search, but none for disputes. `src/lib/paypal/disputes.ts` calls `/v1/customer/disputes` directly, with request shapes taken from the official OpenAPI schema (`developer.paypal.com/api/customer-disputes/v1/schema.json`). Orders, capture and tracking go through the Server SDK's `OrdersController` (`createOrder`, `captureOrder`, `getOrder`, `createOrderTracking`). We keep the raw JSON body from the SDK so stored data keeps PayPal's own snake_case field names.

**The buyer is played with the documented unsigned JWT.**
The sandbox-only buyer calls (create dispute, change reason, accept offer) carry a `PayPal-Auth-Assertion` header built exactly as PayPal's set-up page shows: header `{"alg":"none","typ":"JWT"}` and payload `{"iss": PAYPAL_CLIENT_ID, "email": PAYPAL_SANDBOX_BUYER_EMAIL}`, base64url-encoded, with an empty signature.

**What the sandbox confirmed on 4 Nov 2026.**
- OAuth with the provided app returns the `disputes/create`, `disputes/read-seller`, `disputes/update-seller` and `disputes/read-buyer` scopes, so the buyer-side create call is authorised for this app.
- `GET /v1/customer/disputes` works and returned an empty list (`fixtures/paypal/recorded/list-disputes-empty.json`).
- `POST /v1/customer/disputes` with the buyer assertion reaches validation and answers `400 INVALID_REQUEST / TRANSACTION_NOT_ELIGIBLE` for a transaction the buyer did not make (`fixtures/paypal/recorded/create-dispute-ineligible.json`).
- A real sandbox capture can be made server-side with a test card (`Orders v2 + payment_source.card`), but disputing that capture as the sandbox buyer is also `TRANSACTION_NOT_ELIGIBLE`: PayPal only lets a buyer dispute a payment from their own PayPal account. So the live lifecycle needs a payment made by a person logged in as the sandbox buyer, as the brief anticipated.
- **Tracking works live** (`scripts/verify-tracking.ts`, 4 Nov 2026). The script makes a test-card capture to our own business account, then `POST /v2/checkout/orders/{id}/track` through the Server SDK's `createOrderTracking` returns 201, and re-reading the order shows the tracker. Responses are in `fixtures/paypal/recorded/tracking-*.json`. The real tracker is just `{ id: "<capture>-<tracking number>", status: "SHIPPED", items, links, notify_payer }`: no carrier name and no scans, which confirms the gap Rebuttal's carrier-document reading fills. Seeded and simulated trackers now use exactly this shape. Card payments with a `payment_source` need a `PayPal-Request-Id` header; the HTTP helper takes one.

**`scripts/sandbox-lifecycle.ts` runs live when given a transaction ID and replays otherwise.**
Steps: create INR dispute as buyer → seller reads it → seller provides `PROOF_OF_FULFILLMENT` (tracking + carrier screenshot as `evidence_file`) → confirm `UNDER_REVIEW` → sandbox `adjudicate SELLER_FAVOR` → confirm `RESOLVED / RESOLVED_SELLER_FAVOUR`. It follows HATEOAS links: if the dispute is still in the inquiry stage without a `provide_evidence` link, or does not reach review after evidence, it calls the seller `escalate` endpoint and re-reads. Every real response overwrites the matching file in `fixtures/paypal/lifecycle/` and is marked `"source": "sandbox"` in `manifest.json`. The fixtures shipped before that run are marked `"documented-sample"`, shaped from the schema. When a live step fails, the error body is saved next to it (`*.error.json`) and that step and the rest are replayed and printed `SIMULATED`.

**Live run on 4 Nov 2026 with transaction `3KV701938H745371C`: refused at step 1, nothing created.**
`POST /v1/customer/disputes` answered `400 INVALID_REQUEST / TRANSACTION_NOT_ELIGIBLE` (debug ids `ca55570a8cc06`, `f12775173ba90`, `f6181433677e4`). To find out why, the script now looks the payment up first with `GET /v2/payments/captures/{id}`, which works with a buyer-side ID whenever this app's account was a party to the payment. The lookup (`fixtures/paypal/recorded/3KV701938H745371C-capture-lookup.json`, emails and merchant IDs redacted) showed three separate blockers:

1. **The payment runs the wrong way.** It is £40.00 GBP paid *to* a sandbox personal account (`sb-3j7y…@personal.example.com`), not to this app's business account (`sb-otkh…@business.example.com`, merchant `UX7A…`). For a dispute, the buyer (personal) must pay the seller (the business account that owns the REST app).
2. **It is not completed.** Status `PENDING`, reason `UNILATERAL`, meaning the money was sent to an address that has not accepted it. Only completed payments can be disputed.
3. **`PAYPAL_SANDBOX_BUYER_EMAIL` is the business (seller) account.** The `PayPal-Auth-Assertion` therefore claimed the *seller* was the buyer. It must be the personal account's email.

What the sandbox supported in this run: OAuth, the capture lookup, and reaching dispute creation, which is authorised and validated. What it did not support: creating a dispute on this transaction, and therefore every later step (read, provide evidence, review, adjudicate). Those still replay the documented-sample fixtures and print `SIMULATED`. The run is logged under `attempts` in `fixtures/paypal/lifecycle/manifest.json`. The manifest's `transaction_id` and `dispute_id` change only when step 1 really runs live.

I did not retry with the transaction's own amount and the business account as "buyer". That could open a dispute in which our app is the buyer and the personal account is the seller, which Rebuttal cannot answer and which would leave a stray dispute in the sandbox.

**Preflight in the app.** The same check (`src/lib/paypal/preflight.ts`) runs when a configured `SANDBOX_*_TRANSACTION_ID` is used. The live create uses the payment's real amount and currency, and a refusal is shown in the call log with the plain-English causes, followed by the simulated fallback. The PayPal status chip shows ⚠ when the buyer email is a business account.

**The app has one PayPal adapter with two implementations per action.**
`src/lib/paypal/gateway.ts` runs each dispute action live for disputes that exist in the sandbox, and through `src/lib/paypal/sim.ts` otherwise. `sim.ts` is a pure state machine over the documented dispute JSON (it is unit-tested). If a live call fails, the simulator replays that one step and the call log shows `SIMULATED` with the sandbox's reason. Each call is labelled with who it is made as: seller, buyer (sandbox) or PayPal (sandbox).

**Demo disputes are opened against configured sandbox transactions.**
`SANDBOX_INR_TRANSACTION_ID` and `SANDBOX_SNAD_TRANSACTION_ID` bind the two story disputes to real sandbox payments. When set and PayPal answers, "a buyer opens a dispute" is a real `POST /v1/customer/disputes` and every later step for that dispute goes to the sandbox. When unset, the dispute is simulated and every badge says so. The INR scenario is $84.00 USD, the price of the mug pair plus shipping in the demo shop, so a buyer who pays for that product produces a transaction of the right amount.

**Unverified assumption: the outcome code after a buyer accepts an offer.**
The simulator resolves an accepted offer as `RESOLVED_WITH_PAYOUT` with `amount_refunded` set to the offer. The schema lists that code but the docs do not say which one an accepted offer produces. The workflow treats `RESOLVED_WITH_PAYOUT`, or any resolution after an accepted offer in the offer history, as "settled". To check once a live SNAD run is possible.

**Fictional carrier, carrier `OTHER`.**
The demo carrier is "Northline Post", so no real carrier's branding appears in evidence images. Tracking is added as `carrier: OTHER` with `carrier_name_other`. This also shows the real gap Rebuttal fills: PayPal's tracker stores the number and a seller-set status (`SHIPPED`), never the carrier's scans.

**JS SDK v5 Smart Buttons.**
The shop uses `https://www.paypal.com/sdk/js` with `paypal.Buttons({ createOrder, onApprove })`, loaded only in the browser via `next/dynamic(..., { ssr: false })`. `createOrder` and `onApprove` call our server, which uses the Server SDK. Without PayPal keys the shop shows a clearly labelled simulated button that goes through the same server code path.

**The sandbox seller account settles in GBP.** A USD test capture showed a GBP receivable. Irrelevant for disputes, which are in the transaction currency, but worth knowing.

## AI

**Model: newest Gemini Flash on the free tier, with a fallback chain.**
*Superseded on 12 Nov 2026: see "Update, 12 Nov 2026" at the end. The order is now newest Flash → `gemini-2.5-flash` → recorded responses.*
The Gemini model list on 4 Nov 2026 has `gemini-3.8-flash` as the newest Flash model. When `AI_MODEL` was empty we used the chain `3.8-flash → 3.5-flash → 2.5-flash → 3.5-flash-lite → 3.1-flash-lite → 2.5-flash-lite`. A 503 ("high demand", which 3.8 often returned) or a 429 moves down the chain. A model that answers 429 is skipped for an hour, because…

**The free tier is about 20 requests per model per day.**
The 429 body says `generate_content_free_tier_requests, limit: 20`. Aliases share a quota (`gemini-3.7-flash` and `gemini-flash-latest` both counted against `gemini-3.8-flash`). One analysis costs about five requests. So:
- a process-wide limiter caps us at 10 requests/minute (`AI_MAX_RPM`);
- vision reads are cached by file hash;
- a whole analysis is cached by a hash of everything it depends on (prompt, dispute, order shipping, tracking, evidence bytes). Re-running the demo after a reset reuses the earlier Gemini run and labels it "cached";
- when every model is out of quota, Rebuttal replays a **recorded real Gemini run** for that scenario (`src/lib/ai/recorded/*.json`, produced by `scripts/record-ai.ts`) and says so in the status chip and the trace;
- for disputes with no recording (for example after uploading new evidence), it falls back to the deterministic rules table and labels the result "Rules only".

**Structured output is tool calls with zod schemas, never parsed text.**
The analyst is a `generateText` tool loop (AI SDK 7). Tools: `get_dispute`, `get_transaction`, `get_tracking_record`, `list_seller_evidence`, `read_carrier_document`, `compare_photos`, `check_evidence_coverage`, and `submit_recommendation` (input schema only, which ends the loop via `hasToolCall`). The vision readers force a single tool call (`toolChoice: { type: "tool" }`) whose input is the zod schema. All model output is validated with zod before use.

**Hard length limits live in code, not in the schema.**
The first schema had `.max()` on strings; Gemini wrote a 230-character bullet and the whole run failed validation. Limits now sit in the field descriptions as guidance, and `tidyRecommendation` trims and caps confidence at 95 after validation.

**The model reads; the rules decide what counts; the server does the money.**
- Facts the model cannot be trusted to compute are computed in code and handed back to it: address match against the PayPal ship-to, tracking-number match, and calendar days between delivery and claim (in the seller's time zone: 5 Nov 2:12 pm → 7 Nov 10:00 am is two days, not one).
- The rules table (`src/lib/rules.ts`) maps each dispute reason to the evidence that answers it, weighted critical/strong/supporting, and produces a baseline action. The UI shows whether the agent agrees.
- The model proposes `offer_percent`. The server turns it into integer minor units with `percentOf` (basis points, half-up) and clamps it below the disputed amount.

**The prompt states how PayPal treats not-as-described claims.**
Without it, the agent recommended "accept" for the bowl. With one paragraph explaining that PayPal usually needs the buyer to return a not-as-described item at their own cost before a full refund, so a partial refund that lets them keep it is often taken, it recommends a 40% offer, which matches the rules-table baseline. This is domain knowledge, not a forced answer: the INR and no-tracking cases still come out as fight and accept.

**A not-as-described dispute does not need carrier delivery.**
The first SNAD rule set required "carrier confirms delivery" as critical, which is irrelevant when the buyer says it arrived but looks wrong. Replaced with "listing discloses natural variation" (strong).

## Product and demo

- **Fictional everything.** Fernhill Ceramics (seller), Jordan Reyes, Priya Natarajan, Sam Whitfield (buyers), Northline Post (carrier). Emails use `.example` domains.
- **Demo clock.** A stored instant that starts at Saturday 7 Nov 2026, 10:00 PT and only moves when the presenter jumps it. Deadlines count down against it. The carrier screenshot's dates are fixed images, so the clock is fixed rather than relative to wall time.
- **Demo director.** A dock at the bottom shows the next story beat and runs it with one click. The beats are derived from the database state, so clicking the real buttons in the UI advances the story just as well. For the approve step the dock submits whatever is in the composer, including edits.
- **Every PayPal call is a toast.** Each new PayPal call pops a toast for five seconds with the endpoint, status and LIVE/SIMULATED badge, so the video can point at every PayPal moment without narration gymnastics. The full log is in the "API log" drawer with request and response JSON.
- **Three actions, three seeded disputes.** INR with strong proof → fight. SNAD with mixed proof → offer. A small untracked letter → accept (pre-seeded, outside the scripted story, to show the third action).
- **Uploads.** Sellers can add a carrier screenshot or PDF, or a pre-shipment photo, and re-run the analysis. Gemini reads PDFs natively. Recorded replays are disabled once uploaded evidence is present, so a replay never pretends to have read a file it did not.

## Stack

- **Next.js 16.4 (App Router), React 19.3, TypeScript 5.** `create-next-app` now enables `cacheComponents`; we turned it off because every screen is live data from SQLite, and dynamic route handlers are simpler and correct here.
- **TypeScript 5, not 7.** `typescript@latest` is 7.0 (the native port); Next's tooling expects the 5.x JS API. Pinned `^5`.
- **`@types/node@22`** because `vitest@5` declares a peer range that excludes Node 20 types.
- **SQLite via better-sqlite3**, seeded on first boot and on "Reset demo". The AI cache survives resets on purpose.
- **Polling, not websockets.** The UI polls `/api/state` every 1.5 s and the open dispute every 0.6–1.5 s. Simple, works on Render's free plan, and fast enough for the agent trace to animate.
- **Not used: Bryntum, AG Grid/AG Studio, Z3.** The brief's general instructions mention them, and the environment has Bryntum and AG Grid keys, but Rebuttal's stack (Next.js, PayPal, Gemini, SQLite) has no scheduling, grid or solver need. Adding them would be features beyond the brief. Nothing in Rebuttal needs the Bryntum trial registry, so `npm install` works without it.
- **Fonts:** Fraunces (display serif, the "legal brief" voice), Inter (UI), JetBrains Mono (API log), via `next/font`.

## Network

No host was blocked. Reachable from the build environment: `api-m.sandbox.paypal.com`, `www.paypal.com` (JS SDK), `generativelanguage.googleapis.com`, `fonts.googleapis.com`, `registry.npmjs.org`. In headless Chromium here, `paypalobjects.com` logo SVGs failed through the proxy; the buttons still render.

## Final audit (5 Nov 2026)

A check of the brief and the Definition of Done against what the code does, run from a clean clone. Lint, typecheck, 38 tests and `next build` pass there. The demo story ran start to finish with `next start` in both modes:
- **Mock mode** (every key unset): all 9 beats, $123.00 USD kept, 10 PayPal calls, all SIMULATED.
- **Live mode** (real keys): all 9 beats with Gemini live. `gemini-3.1-flash-lite` answered after the newer models were busy or out of quota. It chose fight (95%) and a 30% offer: $45.50 USD kept on the bowl, $129.50 USD in total. All 10 dispute-story PayPal calls were still SIMULATED, because no disputable sandbox transaction is configured.

### Works end to end, live
- Gemini agent: tool loop, carrier screenshot and PDF reading, photo comparison, zod validation, model fallback chain, caching.
- PayPal OAuth, Orders v2 create, test-card capture, order tracking (`scripts/verify-tracking.ts`), the payment preflight lookup, and the create-dispute call (reached, then refused with `TRANSACTION_NOT_ELIGIBLE`).
- PayPal JS SDK Smart Buttons render on `/shop`, and their `createOrder` callback's server path creates real sandbox orders.

### Works only in mock / simulated form
- Every dispute step after creation: show, provide-evidence, make-offer, accept-claim, adjudicate, accept-offer. The code is written against the official schema and switches to live for any dispute that exists in the sandbox, but none has run live because no dispute could be created.
- The lifecycle fixtures in `fixtures/paypal/lifecycle/` are documented samples, not recordings.

### Gaps, stated plainly
- **Rebuttal does not watch the seller's real PayPal inbox.** The brief says "watches the seller's disputes" and lists "list" among the endpoints. `listDisputes()` exists and a manual call returned an empty list, but the app never calls it. The inbox holds the seeded scenario and disputes Rebuttal opened itself. Importing arbitrary sandbox disputes would also need their order and evidence, which Rebuttal only has for its own shop's orders. We left this out rather than add a feature in the final pass. The README and SUBMISSION now say so instead of claiming "watches".
- **Deadlines are tracked on screen only.** The inbox sorts by deadline and counts down against the demo clock. There are no reminders or notifications.
- **The JS SDK checkout has not been completed by a buyer.** The buttons render and orders are created, but approving a payment needs a sandbox buyer login we haven't had.
- **Unverified assumption:** an accepted offer resolving as `RESOLVED_WITH_PAYOUT` (see above).
- **Live Gemini answers vary.** The offer percentage differed between runs (40% recorded, 30% live). The money maths and the rules-table cross-check are deterministic; the recommendation text is not.
- **Live analyses can be slow** (over a minute) when the free tier pushes the chain down to later models.
- **No authentication.** Anyone who can reach the server can reset the demo and trigger sandbox calls and Gemini requests with the configured keys. Fine for a local demo; for a public link, deploy in mock mode or behind a password.
- **Not deployed yet.** `render.yaml` is written but untested on Render.
- **First run needs network for fonts.** `next/font` downloads Google Fonts on first dev run and at build time.

### Fixed in this pass
- The top-bar AI chip now reports a fallback (recorded or rules-only after a rate limit or outage), as the brief requires. Before, it said "Gemini live" regardless.
- `scripts/sandbox-lifecycle.ts` exits with code 2 when a transaction ID was given but no step ran live, instead of 0.
- README, DEMO and SUBMISSION no longer claim the app watches or lists disputes, no longer present recorded numbers as guaranteed live results, and say which PayPal steps are simulated.

## Update, 12 Nov 2026

**Project rules from the owner.**
- Commits are made as Nisaar (`120457154+eshygn@users.noreply.github.com`), with no assistant author or co-author.
- `.claude/hooks/session-start.sh` sets that identity at the start of every session; it's registered in `.claude/settings.json`.
- Work goes straight to `main`, with no pull requests.

**AI order changed to exactly what the owner asked:** Gemini's newest Flash model, then `gemini-2.5-flash`, then recorded responses.
- Newest Flash is `gemini-3.8-flash` in the model list on 12 Nov. The four other models in the old chain were removed.
- A 404 ("model not available to this key") now also moves to the next step, as do 503 and 429.
- The top bar names the model that answered the last analysis, or says "recorded responses (Gemini unavailable)" with the reason on hover.
- `AI_MODEL` and `AI_FALLBACK_MODEL` override the two models without a code change.

**What the new keys did when tested on 12 Nov:**
- **Gemini key: valid.**
  - `gemini-3.8-flash`: 503 "high demand" on both tries.
  - `gemini-2.5-flash`: **404, "no longer available to new users"**. So with this key the requested second step can never answer.
  - Working on this key: `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-latest`.
  - We kept the owner's order (2.5 as the default fallback) and documented `AI_FALLBACK_MODEL=gemini-3.5-flash` as the switch, rather than quietly choosing a different model.
- **PayPal client ID / secret: rejected** (`invalid_client`) by both the sandbox and live OAuth endpoints.
  - The secret supplied has the same `AQ.…` prefix as the Gemini key, which is Google's key format, not PayPal's, so it is probably the wrong value.
  - Until it's replaced, every PayPal call is simulated.
  - The PayPal chip now says "PayPal rejected the client ID / secret" instead of the misleading "unreachable".
- The keys live only in a local, git-ignored `.env`. Commands were run with the inherited environment variables removed, so only those values were used.

**Verified on 12 Nov from a clean clone, using only `.env`:**
- `npm ci`, lint, typecheck, 38 tests and `next build` all pass.
- The 9-beat story completes on `next start`.
- PayPal: simulated (credentials rejected).
- AI: recorded responses, because 3.8 was overloaded and 2.5 returned 404. The top bar and the agent panel both said so.

**Commit history.** Commits made before the identity rule existed carried a different author. None had a co-author trailer. They were re-authored with the owner's approval (below).

**Later on 12 Nov: new PayPal secret, second model changed, history rewritten.**
- **PayPal:** the owner supplied the correct sandbox secret, and OAuth now works.
  - The app's seller account is `sb-vgizy53112725@business.example.com` (merchant `VCUK…`), with the same dispute scopes as before.
  - Verified live: OAuth, Orders v2 create (the shop's route), test-card capture, and add tracking (`scripts/verify-tracking.ts`, 201).
  - List disputes returns 0: no buyer has made a disputable payment to this account, so the dispute story is still simulated.
- **AI:** the owner chose `gemini-3.5-flash` as the second model in place of `gemini-2.5-flash`, which returns 404 for their key.
  - Live run from a clean clone using only `.env`: `gemini-3.8-flash` was skipped, `gemini-3.5-flash` answered both disputes, and the top bar showed it.
  - Results: fight (95%) and a 20% offer, $136.00 USD kept in total. Live offers vary between runs; the recorded run uses 40%.
- **History:** with the owner's approval, the earlier commits were re-authored to the owner's identity and `main` was force-pushed. Commit contents and messages are unchanged.
- **PayPal SDK logging is off.** At `LogLevel.Error` the SDK still printed every successful request prefixed "error:", which read like failures.

**Second buyer transaction, 12 Nov: `03W14967454290406`. Refused, nothing created.**
- The buyer email is now the personal account, `sb-tqii…@personal.example.com`.
- The preflight lookup found a **completed $500.00 USD payment *to* that personal account**, so it was sent from the business account to the buyer: the wrong direction for a dispute.
- `POST /v1/customer/disputes` then failed earlier than before, at the buyer identity: `400 invalid_request: "No permissions to set target_client_id"`.
  - This is the `PayPal-Auth-Assertion` being refused. PayPal's set-up page requires the sandbox buyer to give the REST app consent once ("Log in with PayPal" with the `disputes/create` scope).
  - The app's token already has the `disputes/create` scope, so consent is the missing piece. We can't confirm consent is the *only* missing piece until a run gets past it.
- Both responses are saved, redacted, in `fixtures/paypal/recorded/03W14967454290406-*.json` and logged under `attempts` in the manifest.
- **Fixed alongside:**
  - `PayPalApiError` now reads PayPal's OAuth-shaped errors (`error` / `error_description`) as well as the REST shape; before, this refusal printed blank.
  - The script and the app's call log now explain this refusal in plain English.
  - Two tests cover both error shapes.

**Buyer consent attempt, 12 Nov: not yet possible.**
- The owner opened the "Log in with PayPal" consent link and PayPal answered "This action isn't supported (invalid client_ID or redirect_uri)".
- From here, both PayPal sign-in endpoints (`/signin/authorize` and `/connect`) return that same error for this app's client ID, with every return URL tried, and even with the basic `openid` scope alone.
- So the problem is not the disputes scope: "Log in with PayPal" is most likely not enabled for the app, or its Return URL wasn't saved.
- This test can't fully confirm it, because a made-up client ID gets the same page. It needs a change in the app's settings on developer.paypal.com.

**Correction, 12 Nov: the "wrong direction" diagnosis was mistaken.**
- The preflight looks a buyer-side transaction ID up with `GET /v2/payments/captures/{id}`. That returns the **buyer's copy** of the record, whose `payee` is the buyer, even when the buyer correctly paid the seller.
- The third transaction, `4JS2751162711051N` ($84.00 USD), proves it. The owner's buyer receipt says "Sent to Test Store" (`sb-vgizy…@business.example.com`), yet the lookup showed the personal account as payee.
- So the earlier "paid to the buyer" readings for `03W14967454290406` and `3KV701938H745371C` were probably wrong too. (`3KV…` really was `PENDING`, which alone blocks a dispute.)
- The direction check is removed. The preflight now checks only that the payment is completed and that the buyer email isn't a business account.
- For all three transactions, PayPal's authoritative answer at the create step is what the attempts log records.
  - With `4JS…` the single blocker is the buyer identity: `invalid_request: "No permissions to set target_client_id"`, meaning the buyer hasn't given consent.
  - The owner saved the "Log in with PayPal" settings on 12 Nov, and PayPal says they take up to three hours to apply. After that, the consent link and then the lifecycle can be retried.

**Deployed and recorded, 12 Nov 2026.**
- **Hosted demo:** https://rebuttal-ck5w.onrender.com/, deployed by the owner from `render.yaml` on Render's free plan and confirmed working by them. It could not be opened from the build environment (the host is not on its network allowlist), so that check is the owner's. It is meant to run without keys, in mock mode.
- **Demo video:** recorded from a local production build with live keys.
  - PayPal showed "sandbox live"; the dispute calls were simulated and labelled.
  - Gemini answered both disputes live on `gemini-3.5-flash-lite`: fight at 95%, and a 25% offer ($48.75 USD kept, $132.75 USD in total).
  - The regular Flash models (3.8, 3.6, 3.5) were overloaded or out of free quota on both of the owner's keys at the time, so the recording set `AI_MODEL=gemini-3.5-flash-lite` for that run only. The app's defaults are unchanged.
- **Screenshots** in `docs/screenshots/` come from that same run.
- **Known issue seen in that run:** the model asked for the photo comparison and the rules check in the same step, so the rules check ran before the photo result arrived. The agent panel shows that earlier score (58/100) while the Evidence rules card shows the final one (75/100). The recommendation and the final score use the complete facts. Not fixed, to avoid a code change after recording.
