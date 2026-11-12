# Rebuttal demo video: script and shot list

**Target length: 2:45** (hard limit 2:50). About 390 spoken words at a calm pace.
Record at **1440×900**, browser zoom 100%, light system theme. Hide the bookmarks bar.

## Before you record

1. `npm run dev` (or open the hosted URL and wait for it to wake).
2. Click **Reset demo**. The inbox shows one open dispute (Sam Whitfield, $14) and the "Before Rebuttal" losses.
3. **Pick a mode and know what it shows.**
   - **Mock mode** (no keys, or `REBUTTAL_MOCK=1`): chips read **PayPal: mock** and **AI: recorded responses**. The agent replays recorded real Gemini runs, so the numbers in this script (95%, 40%, $39, $123) are exactly what appears. Every PayPal toast says **SIMULATED**.
   - **Live keys**: chips read **PayPal: sandbox live** and **AI: Gemini live · <model>**. Gemini answers live, so read the confidence and offer amount off the screen; a live run on 5 Nov chose 30% ($45.50 kept, $129.50 total). The dispute PayPal calls still show **SIMULATED** unless `SANDBOX_INR_TRANSACTION_ID` / `SANDBOX_SNAD_TRANSACTION_ID` hold sandbox payments PayPal accepts. As of 5 Nov, none does.
   - Either way, say "the sandbox" for the PayPal-decides and buyer-accepts steps, and keep the SIMULATED badge visible. Don't claim a live PayPal ruling.
4. Run the story once off-camera, then **Reset demo**. With live keys this warms the Gemini cache. Otherwise a live analysis can take a minute or more if the newest Flash model is busy, before it falls back to `gemini-2.5-flash` and then to recorded responses.
5. Keep the dock (bottom, dark) visible. Every story beat is its **Next →** button.

## Script

| Time | Shot | Words (voice-over) | On screen |
| --- | --- | --- | --- |
| **0:00–0:20** | Title card over the Rebuttal welcome screen. Slow push-in on the "Before Rebuttal" list in the left rail. | "If you run a small online shop, a PayPal dispute is a freeze on your money and a deadline. Most small sellers either give up or send a weak reply, because finding the right proof for each kind of dispute takes hours. This shop already lost two disputes it should have won." | Title "Rebuttal: win the PayPal disputes worth winning". Highlight *lost $48.00 USD* and *lost $36.00 USD*. |
| **0:20–0:30** | Full app. | "Rebuttal takes each PayPal dispute and does the gathering for you. Here's Fernhill Ceramics, a two-person pottery studio." | Cursor over the top bar: demo clock, PayPal chip, AI chip. |
| **0:30–0:42** | Press **Next → A buyer opens a dispute**. The new card slides in; the detail opens. | "A buyer, Jordan, says his $84 mug order never arrived. PayPal freezes the money and the clock starts: ten days to respond." | **PayPal moment 1:** toast *Sandbox · buyer opens dispute: POST /v1/customer/disputes*. Point at the `10d 0h left` pill and *On hold by PayPal*. |
| **0:42–1:05** | Press **Build my case →**. Let the agent trace fill in. | "Rebuttal's agent pulls the dispute, the original payment and the PayPal tracking record. But PayPal's tracker only knows what the seller typed: a number and 'shipped'. So Gemini reads the carrier's own tracking page: delivered on the fifth, to the exact address on the PayPal payment, two days before the claim." | **PayPal moment 2:** toasts *Show dispute details*, *Show order details*. Blue *PayPal API* and purple *Gemini vision* badges in the trace. Scroll to **Proof of delivery**: *What PayPal's tracking API knows* vs *What the carrier says*, with ✓ matches PayPal. |
| **1:05–1:20** | Verdict card and **Evidence rules**. | "A fixed rules table checks what this dispute reason needs. Everything's here, so Rebuttal recommends: fight. It shows the reasoning, its confidence, and that the rules agree." | Big **FIGHT**, 95%, *✓ Rules table agrees*. Checklist all ✓. |
| **1:20–1:35** | Scroll to the composer. Press **Next → Approve and submit**. | "It's drafted the response and built the evidence pack. Maya reads it, approves, and Rebuttal submits it through the Disputes API." | **PayPal moment 3:** endpoint chip `POST …/provide-evidence`, then the toast *Provide evidence*. Status changes to *under review*. |
| **1:35–1:45** | Press **Next → Jump 3 days**. | "Three days later, the sandbox plays PayPal's decision. Seller wins. Eighty-four dollars, released." | **PayPal moment 4:** toast *Sandbox · PayPal adjudicates (SELLER_FAVOR)*. Green **Won** banner, **WON** stamp, *Kept with Rebuttal $84.00*. |
| **1:45–2:00** | Press **Next → A second dispute arrives**, then **Next → Analyse**. | "Not every dispute should be fought. Priya says her cobalt bowl arrived a much paler blue. Gemini compares her photo with the listing photo, and she has a point." | Listing photo vs buyer photo side by side. Trace: *Compared the buyer's photo with the listing*. |
| **2:00–2:20** | Verdict **OFFER**, outcomes row. | "Rebuttal doesn't bluff. There's no photo of this exact bowl before it shipped, so fighting would probably lose, and PayPal would have her ship it back. It recommends a partial refund instead: she keeps the bowl, Maya keeps most of the sale." | Amber **OFFER**, outcome tiles *Fight $65 / Offer $39 kept / Accept $0*. Rules table: one ✗ *against*. |
| **2:20–2:32** | **Next → Send the offer**, then **Next → Jump 1 day**. | "One click sends the offer through PayPal. The next day the buyer accepts. Case closed, no return, no lost case." | **PayPal moment 5:** toast *Make offer*. **PayPal moment 6:** toast *Sandbox · buyer accepts offer*. Banner **Settled · $39.00 kept**. |
| **2:32–2:45** | Open **API log** for two seconds, close it, then hold on the left rail. | "Every PayPal call is labelled: live, or simulated in PayPal's documented format. Two disputes, minutes of the seller's time, and money kept that used to be written off. Rebuttal: fight what you can win, settle what you can't." | API log drawer with LIVE/SIMULATED badges. Final frame: *Kept with Rebuttal $123.00 USD*. Logo. |

## PayPal moments to call out (on-screen captions)

Caption each with the badge the toast shows (LIVE or SIMULATED).

1. **Disputes API (sandbox): buyer opens dispute.** `POST /v1/customer/disputes`
2. **Disputes API + Orders: Rebuttal pulls the case.** `GET /v1/customer/disputes/{id}`, `GET /v2/checkout/orders/{id}`
3. **Disputes API: provide evidence.** `POST …/provide-evidence`
4. **Disputes API (sandbox): PayPal adjudicates.** `POST …/adjudicate`
5. **Disputes API: make offer.** `POST …/make-offer`
6. **Disputes API (sandbox): buyer accepts offer.** `POST …/accept-offer`

Optional B-roll (if time is left in the edit): the **Shop & orders** page with PayPal Smart Buttons and *Mark shipped + add tracking* (`POST /v2/checkout/orders/{id}/track`).

## If something goes wrong while recording

- The analysis seems slow: Gemini's free tier is busy. Wait. The trace keeps moving, and if the quota is gone the chip switches to *Recorded Gemini run*. That is still a real Gemini run, recorded earlier.
- A toast says **SIMULATED** on a live take: the sandbox refused that step, and the call log row shows why. Keep going; the story is unaffected.
- Start over at any point with **Reset demo**.
