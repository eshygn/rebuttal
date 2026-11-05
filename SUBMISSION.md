# Devpost submission draft

**Project name:** Rebuttal
**Tagline:** Win the PayPal disputes worth winning, settle the rest in minutes.

## Inspiration

Small online sellers lose disputes they should win. A buyer clicks "item not received", PayPal freezes the money, and a response deadline starts. The proof usually exists: a carrier page showing the parcel delivered, a listing that disclosed variation, a message thread. But it is scattered across a carrier site, a shop admin, a photos folder and an inbox, and each dispute reason needs different proof. So sellers either give up or send a weak "it was shipped!" reply and lose.

We also noticed a gap in the tooling. PayPal's Agent Toolkit can list and read disputes, but the only dispute action it exposes is accepting the claim, which means giving up. We wanted an agent that works for the seller.

## What it does

For each of a seller's PayPal disputes, Rebuttal:

1. **Pulls the case** from PayPal: the dispute, the original payment (Orders v2) and the PayPal tracking record.
2. **Reads the seller's own evidence with Gemini vision**: carrier screenshots and PDFs, listing photos, the buyer's photos. PayPal's tracking API only holds what the seller typed (a number and "shipped"). Rebuttal reads the carrier's actual delivery scan: status, date and time, and address.
3. **Checks a fixed rules table** that maps each dispute reason to the evidence that answers it, and shows what's present, missing or against the seller.
4. **Recommends one action** with its reasoning and confidence: **fight** (and builds the evidence pack and drafts the response), **offer** a partial refund (with the amount), or **accept**.
5. **Submits through the PayPal Disputes API** after the seller approves (`provide-evidence`, `make-offer` or `accept-claim`), then tracks every deadline.

In the demo story:
- **An "item not received" claim for $84.** The carrier's proof of delivery, two days before the claim, answers it. Rebuttal fights, and the sandbox step that plays PayPal's decision rules for the seller.
- **A "not as described" claim on a bowl.** The evidence is weak, so Rebuttal recommends a partial refund instead of a doomed fight (40% in the recorded run). The buyer accepts, and the seller keeps most of the sale and avoids a return.

**What is live and what is simulated (as of 5 Nov 2026).**
- **Live:**
  - the Gemini agent: tool loop, vision reading of screenshots and PDFs, photo comparison;
  - PayPal OAuth, Orders v2 create and capture, and order tracking;
  - the JS SDK buttons rendering.
- **Simulated:** the dispute steps after creation.
  - The sandbox reached our create-dispute call and refused every transaction we could give it (one was a payment *from* the shop *to* the buyer, still pending).
  - So no dispute has yet existed for the later steps to act on.
  - Those steps are coded against PayPal's schema and run live as soon as a dispute exists. Until then a tested simulator replays them in PayPal's documented format, and every call is labelled SIMULATED on screen.

## How we built it

- **Next.js 16 (App Router) + TypeScript**, one Node service, SQLite (better-sqlite3) seeded with a fictional scenario.
- **PayPal**: JS SDK Smart Buttons for the shop checkout; the **PayPal Server SDK** (`OrdersController`) for create/capture/get order and **order tracking**; the **Disputes API** over REST for show, provide-evidence (multipart with files), make-offer and accept-claim. We also wrote the **sandbox-only** endpoints that play the buyer (create dispute and accept offer, with a `PayPal-Auth-Assertion` JWT) and play PayPal (`adjudicate`, plus `escalate` and `require-evidence` in the lifecycle script). A lifecycle script first looks the payment up, explains in plain English why it can or can't be disputed, then runs the lifecycle and saves every real response as a fixture.
- **AI**: Vercel AI SDK 7 with `@ai-sdk/google` on the Gemini API free tier. The analyst is a tool-calling agent (`get_dispute`, `get_transaction`, `get_tracking_record`, `read_carrier_document`, `compare_photos`, `check_evidence_coverage`, `submit_recommendation`). Every output is a zod-validated tool call, and vision readers force a single structured tool call.
- **Guardrails in code, not prompts**: address matching, tracking-number matching and delivery-vs-claim dates are computed deterministically and handed to the model. Offer amounts are converted from a percentage to integer minor units on the server. The rules table gives a baseline that the agent's answer is shown against.
- **One adapter, two implementations** for every external call: live (PayPal sandbox, Gemini) and mock (a tested sandbox state machine that emits PayPal's documented JSON, plus recorded real Gemini runs). Every PayPal call is shown on screen as LIVE or SIMULATED.
- **Demo mode**: a deterministic scenario, a demo clock that jumps time forward, a one-click "Reset demo", and a director dock that runs the story beat by beat.

## Challenges we ran into

- **The sandbox only lets a buyer dispute their own PayPal payment.** We could create a real sandbox capture server-side with a test card, but disputing it returned `TRANSACTION_NOT_ELIGIBLE`. We then got a transaction ID from a human tester, but it was also refused. Our new preflight lookup showed why: the money had gone from the shop *to* the buyer, the payment was still pending, and the configured buyer email was the seller's own account. So we built against documented fixtures, made the refusal reasons visible in both the script and the app, and labelled everything the sandbox won't reach as "simulated".
- **The Gemini free tier allows about 20 requests per model per day**, and the newest Flash model often returned "high demand". We added a model fallback chain, per-model quota tracking, a request limiter, caching of vision reads and whole analyses, and replay of recorded real runs, each labelled in the UI.
- **Schema strictness vs model output.** A hard `max(220)` on a reasoning bullet failed an entire agent run. Limits moved into the field descriptions and a post-validation tidy step.
- **Getting the advice right, not just the extraction.** At first the agent told the seller to accept a "not as described" claim. Once the prompt explained that PayPal normally makes the buyer return the item at their own cost before a full refund, it chose a partial refund, matching what the rules table and an experienced seller would do.

## Accomplishments that we're proud of

- The agent turns a seller's screenshot into PayPal-ready evidence, and shows side by side what PayPal knows and what the carrier knows.
- It is honest: it recommends a partial refund or a full refund when fighting would lose, and it tells the seller when the rules table disagrees with it.
- Every PayPal moment is visible on screen, live or simulated, with the request and response JSON one click away.
- Money is integer minor units end to end, always shown with its currency.
- 38 tests cover the money maths, both state machines, the payment preflight, the rules table, the AI schemas and the whole demo story.

## What we learned

- What PayPal's dispute data contains and what it lacks. The tracker stores the seller's input, not the carrier's scans, which is exactly where a vision model helps.
- The Disputes API is HATEOAS-driven. Following the `links` on each dispute is more reliable than hard-coding which action is allowed when.
- Small, deterministic checks (address match, day counts, money) make an LLM agent trustworthy. The model reads and argues; code does the arithmetic.

## What's next

- Watch the seller's real dispute inbox: `CUSTOMER.DISPUTE.*` webhooks plus a list-disputes sync (today the inbox holds the demo scenario and disputes Rebuttal opened), and Log in with PayPal so any seller can connect their account.
- Run the full dispute lifecycle live in the sandbox once a disputable buyer payment is available.
- Pulling evidence automatically from carriers, Shopify and marketplace order pages.
- Chargebacks and the appeal flow, plus per-seller outcome tracking to tune the rules table on real wins and losses.
- A "prevention" view: which products and listings attract not-as-described claims, and which listing wording would have prevented them.

## Built with

`paypal-disputes-api` · `paypal-orders-v2` · `paypal-js-sdk` · `paypal-server-sdk` · `paypal-tracking` · `gemini` · `google-gemini-api` · `vercel-ai-sdk` · `next.js` · `react` · `typescript` · `sqlite` · `better-sqlite3` · `zod` · `vitest`
