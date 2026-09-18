# catalyst-picks

Scheduled AI **crypto** picks for Catalyst, graded against real prices — relative to Bitcoin.

| Board   | Cut on          | Covers        |
|---------|-----------------|---------------|
| daily   | every day       | next 24 hours |
| weekly  | Monday          | week ahead    |
| monthly | 1st of month    | month ahead   |

Each run grades the outgoing board first, then publishes the next.

## Why crypto and not stocks

This started as a stock picker. Every US equities vendor forbids showing price-derived
data to end users without a redistribution licence — quotes came back at $150/month
(Tiingo, Finnhub, marketdata.app), $399 (EODHD) and **$1,500/month plus exchange fees**
(Databento), whose support was explicit: *"Any data that requires our product as an input
in its creation process counts as derived data."*

CoinGecko's terms are the opposite: *"You're entitled to charge for your services and
products that incorporate or integrate data from CoinGecko API."* What is forbidden is
reselling **access to the API**, not displaying data in a paid app. Free tier is 10,000
calls/month; this pipeline uses roughly one call per run.

**Attribution is a licence condition** — the app must show "Powered by CoinGecko"
with a link. Do not remove it.

## Grading is relative to BTC

`resultPct = (coin move − BTC move)`, sign-flipped for shorts.

Most alts are high-beta BTC bets. A coin up 3% on a day BTC rose 4% *lost* you money
versus just holding BTC, and grading against zero would credit the model for market beta
it did not produce. Relative scoring isolates whatever selection skill actually exists.
It makes the record look worse. It is the honest number.

## Integrity rules

- Grade **every** pick. Never delete a loser from the archive.
- A pick with no resolvable price stays **ungraded**, never guessed.
- **Never grade with an LLM.** Measured 2026-09-10 against Nasdaq's own closes, Gemini
  with search grounding returned two false prices out of fifteen, off by up to 0.47%,
  with nothing marking the wrong ones.
- Entry price is captured from the same snapshot the model reasoned over, so the price
  shown on the board is the price it is graded from. Do not switch to CoinGecko's
  `/history` — it only covers completed UTC days and silently returns null for today.

## Run locally

```bash
GEMINI_API_KEY=... node generate-picks.mjs
GEMINI_API_KEY=... PICKS_ONLY_HORIZON=daily node generate-picks.mjs
```
