# catalyst-picks

Scheduled AI stock picks for **Catalyst**, graded against real closing prices.

Three boards on a fixed schedule:

| Board   | Cut on                          | Covers        |
|---------|---------------------------------|---------------|
| daily   | every weekday after the close   | next session  |
| weekly  | Friday after the close          | the week ahead|
| monthly | last weekday of the month       | the month ahead|

Each run **grades the outgoing board first**, then publishes the next one. Grading
needs the session's official close, which is why the job runs after the bell
rather than before the open.

## Why the schedule is fixed

The publisher's exclusion that lets a newsletter give securities opinions without
registering as an investment adviser turns on the publication being bona fide,
**impersonal**, and **regularly circulated**. Every subscriber gets the identical
board. Nothing is tailored to anyone's finances. Keep it that way.

## Prices

`price-provider.mjs` is the only file that talks to a market data vendor. It
defaults to a **development-only** source that is not licensed for showing data
to end users. Before launch, set `PRICE_PROVIDER` and the matching token to a
commercially licensed vendor — that is the entire swap.

**Never grade with an LLM.** Measured 2026-09-10 against Nasdaq's own closes,
Gemini with search grounding returned two false prices out of fifteen answers,
off by up to 0.47%. A day-trade moves 1-3%, so that is enough to report a loser
as a winner, and nothing in the response marks the wrong ones.

## Integrity rules

- Grade **every** pick. Never delete a loser from the archive.
- A pick with no resolvable price stays **ungraded**, never guessed.
- Methodology is close-to-close and disclosed. Don't change it retroactively.

## Run locally

```bash
GEMINI_API_KEY=... node generate-picks.mjs
GEMINI_API_KEY=... PICKS_ONLY_HORIZON=daily node generate-picks.mjs   # force one board
```
