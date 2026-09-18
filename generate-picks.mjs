/**
 * Catalyst's scheduled crypto picks.
 *
 * Three boards, each on its own cycle:
 *   daily   — published every day, graded the next day, then replaced
 *   weekly  — published Monday, held all week, graded the following Monday
 *   monthly — published on the 1st, held all month, graded on the next 1st
 *
 * A board is NEVER touched between publication and grading. Each run grades the
 * outgoing board of any horizon that is due, then publishes its replacement, so
 * the graded record and the live board always agree.
 *
 * Crypto trades 24/7, so unlike the equities version there is no closing bell to
 * work around and no weekend gap. Boards are cut at a fixed UTC hour and graded
 * against the price at the same hour, which keeps every comparison like-for-like.
 *
 * The fixed schedule is also deliberate for the same reason it was in the stock
 * version: a bona fide, impersonal, regularly circulated publication is what
 * keeps this commentary rather than personalised advice. Every subscriber gets
 * the identical board. Nothing is tailored to anyone's finances.
 */

import { CATEGORY_KEYS, universeFor, labelFor, symbolFor, resolveId, BENCHMARK_ID, BENCHMARK_SYMBOL } from './categories.mjs';
import { getMarkets, pctChange, providerName } from './price-provider.mjs';
import { readFile, writeFile } from 'node:fs/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';

const PICKS_FILE = 'picks.json';
const ARCHIVE_FILE = 'picks-archive.json';

const BOARD_SIZE = { daily: 5, weekly: 5, monthly: 5 };

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

/**
 * googleSearch cannot be combined with responseMimeType or responseSchema — the
 * API rejects the pairing — so the JSON contract lives in the prompt and is
 * recovered by tryParseJson.
 */
async function gemini(prompt) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 8192 },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const sources = data?.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0;
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return { text, sources };
}

function tryParseJson(raw) {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(raw.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const HORIZON_BRIEF = {
  daily: 'the next 24 hours',
  weekly: 'the coming week',
  monthly: 'the coming month',
};

function marketTable(universe, markets) {
  const lines = [];
  for (const [id, sym] of universe) {
    const m = markets[id];
    if (!m) continue;
    const c24 = m.change24h == null ? '?' : `${m.change24h > 0 ? '+' : ''}${m.change24h.toFixed(2)}%`;
    const c7 = m.change7d == null ? '?' : `${m.change7d > 0 ? '+' : ''}${m.change7d.toFixed(2)}%`;
    lines.push(`${sym} (${id}) $${m.price}  24h ${c24}  7d ${c7}  mcap $${(m.marketCap / 1e9).toFixed(2)}B  vol $${(m.volume / 1e6).toFixed(0)}M`);
  }
  return lines.join('\n');
}

function buildPrompt(horizon, categoryKeys, count, dateStr, universe, markets) {
  const names = categoryKeys.map(labelFor).join(', ');
  return `You are a crypto analyst writing a scheduled market note. Today is ${dateStr} (UTC).

Search the web for what is actually moving these assets right now:
- Token unlocks and vesting cliffs (these are scheduled and public — check them)
- Exchange listings and delistings
- Protocol upgrades, mainnet launches, hard forks
- ETF flows, regulatory decisions, enforcement actions
- Hacks, exploits, depegs
- Funding rates, open interest, and notable on-chain flows

Then select the ${count} most compelling ideas for ${HORIZON_BRIEF[horizon]} from
this ${names} universe ONLY. Live market data:

${marketTable(universe, markets)}

RULES
1. Pick ONLY from the coins listed above, and use the exact id in parentheses.
2. Every pick needs a concrete, checkable catalyst — a named unlock, listing,
   upgrade, filing or flow. "Momentum is strong" is not a catalyst.
3. Direction must be "long" or "short".
4. IMPORTANT — picks are graded RELATIVE TO ${BENCHMARK_SYMBOL}. A coin that rises
   less than ${BENCHMARK_SYMBOL} is a LOSING long. Do not pick something purely
   because you expect the whole market to rise; pick what you expect to
   OUTPERFORM ${BENCHMARK_SYMBOL}. If you are bullish on beta alone, say so in the
   risk field.
5. Do NOT state a target price or a stop. This is impersonal commentary, not
   instructions for any individual.
6. Do NOT reference portfolio size, allocation, position sizing, or what any
   reader should do with their money.
7. If you cannot find ${count} ideas with a real catalyst, return fewer.

Return ONLY this JSON, no prose:
{
  "picks": [
    {
      "id": "solana",
      "direction": "long",
      "conviction": "high",
      "catalyst": "one sentence naming the specific event",
      "rationale": "2-3 sentences of reasoning",
      "risk": "one sentence on what would invalidate this"
    }
  ]
}`;
}

async function generateBoard(horizon, categoryKeys, count, dateStr, markets) {
  const universe = universeFor(categoryKeys);
  const allowed = new Set(universe.map(([id]) => id));
  const prompt = buildPrompt(horizon, categoryKeys, count, dateStr, universe, markets);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { text, sources } = await gemini(prompt);
      console.log(`  attempt ${attempt} — search sources: ${sources}`);
      const picks = tryParseJson(text)?.picks;
      if (!Array.isArray(picks) || picks.length === 0) continue;
      const clean = picks
        .map((p) => ({ ...p, _id: resolveId(p?.id ?? p?.symbol ?? p?.ticker, allowed) }))
        .filter((p) => {
          if (!p._id) console.log(`  dropped off-universe id: ${p?.id ?? p?.symbol}`);
          return Boolean(p._id);
        })
        .map((p) => ({
          id: p._id,
          symbol: symbolFor(p._id),
          direction: p.direction === 'short' ? 'short' : 'long',
          conviction: ['high', 'medium', 'low'].includes(p.conviction) ? p.conviction : 'medium',
          catalyst: p.catalyst ?? '',
          rationale: p.rationale ?? '',
          risk: p.risk ?? '',
          // Entry is captured from the SAME snapshot the model reasoned over, so
          // the price a user sees on the board is the price it is graded from.
          entryPrice: markets[p._id]?.price ?? null,
        }));
      if (clean.length) return clean.slice(0, count);
    } catch (e) {
      console.log(`  attempt ${attempt} failed: ${e.message}`);
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grade a board against real prices, RELATIVE TO BITCOIN.
 *
 * Uses the entry price captured when the board was published and the live spot
 * price now — NOT CoinGecko's /history endpoint. /history only covers completed
 * UTC days, so grading anything against "today" returned null and silently left
 * every board ungraded. Spot-to-spot is available at any hour and, crucially,
 * grades from exactly the price shown on the board when it was published.
 *
 * This is the central methodology decision and the honest one. Most alts are
 * high-beta bets on BTC: on a day BTC rises 4%, a coin up 3% has cost you money
 * versus simply holding BTC. Grading against zero would credit the model for
 * market beta it did not produce and would make the record look far better than
 * it is. Relative scoring isolates whatever selection skill actually exists.
 *
 * resultPct = (coin move - BTC move), sign-flipped for shorts.
 *
 * Prices that cannot be resolved leave the pick UNGRADED rather than guessed.
 * An ungraded pick is honest; a wrongly graded one destroys the only thing the
 * product sells.
 */
async function gradeBoard(board, exitDay, markets) {
  if (!board?.picks?.length) return board;

  const benchEntry = board.benchmarkEntry ?? null;
  const benchExit = markets[BENCHMARK_ID]?.price ?? null;
  const benchMove = pctChange(benchEntry, benchExit);
  if (benchMove === null) {
    console.log(`  cannot price ${BENCHMARK_SYMBOL} (entry=${benchEntry} exit=${benchExit}); board left ungraded`);
    return board;
  }
  console.log(`  ${BENCHMARK_SYMBOL} benchmark ${board.date} -> ${exitDay}: ${benchMove > 0 ? '+' : ''}${benchMove}%`);

  let graded = 0;
  for (const pick of board.picks) {
    if (pick.result) continue;
    const exit = markets[pick.id]?.price ?? null;
    const move = pctChange(pick.entryPrice, exit);
    if (move === null) {
      console.log(`  ${pick.symbol}: no price (entry=${pick.entryPrice} exit=${exit}), left ungraded`);
      continue;
    }
    const rel = Number((move - benchMove).toFixed(2));
    const signed = pick.direction === 'short' ? -rel : rel;
    Object.assign(pick, {
      exitPrice: exit,
      exitDate: exitDay,
      changePct: move,
      benchmarkPct: benchMove,
      resultPct: Number(signed.toFixed(2)),
      result: signed > 0 ? 'W' : signed < 0 ? 'L' : 'push',
    });
    graded++;
    console.log(`  ${pick.symbol} ${pick.direction}: ${move > 0 ? '+' : ''}${move}% vs BTC ${benchMove > 0 ? '+' : ''}${benchMove}% = ${signed > 0 ? '+' : ''}${signed.toFixed(2)}% ${pick.result}`);
  }

  if (graded) {
    const done = board.picks.filter((p) => p.result);
    board.gradedAt = new Date().toISOString();
    board.heldDays = Math.max(1, Math.round((Date.parse(exitDay) - Date.parse(board.date)) / 86400000));
    board.benchmark = { symbol: BENCHMARK_SYMBOL, pct: benchMove };
    board.record = {
      wins: done.filter((p) => p.result === 'W').length,
      losses: done.filter((p) => p.result === 'L').length,
      avgPct: done.length ? Number((done.reduce((s, p) => s + p.resultPct, 0) / done.length).toFixed(2)) : null,
    };
  }
  return board;
}

/**
 * Update the running performance of a board that is still open.
 *
 * Grading only happens when a board is replaced, which for the monthly board is
 * once every ~30 days. Without this, a user opening the app on the 12th sees a
 * monthly board with no indication of how it is doing — the record would be
 * blank for four weeks at a time. This marks every open board to market on every
 * run, so performance is current daily across all three horizons.
 *
 * Deliberately writes `livePct` / `liveRecord` and NOT `result`. The final grade
 * is what gets archived and what the track record is built from; a running
 * number is provisional and must never be mistaken for it. gradeBoard also skips
 * picks that already have `result`, so writing it here would silently prevent
 * the real grade from ever being computed.
 */
function markToMarket(board, markets, today) {
  if (!board?.picks?.length) return board;

  const benchNow = markets[BENCHMARK_ID]?.price ?? null;
  const benchMove = pctChange(board.benchmarkEntry, benchNow);
  if (benchMove === null) return board;

  let marked = 0;
  for (const pick of board.picks) {
    const now = markets[pick.id]?.price ?? null;
    const move = pctChange(pick.entryPrice, now);
    if (move === null) continue;
    const rel = Number((move - benchMove).toFixed(2));
    pick.livePrice = now;
    pick.liveChangePct = move;
    pick.livePct = Number((pick.direction === 'short' ? -rel : rel).toFixed(2));
    marked++;
  }
  if (!marked) return board;

  const scored = board.picks.filter((p) => typeof p.livePct === 'number');
  board.liveAsOf = today;
  board.liveBenchmarkPct = benchMove;
  board.liveRecord = {
    ahead: scored.filter((p) => p.livePct > 0).length,
    behind: scored.filter((p) => p.livePct < 0).length,
    avgPct: Number((scored.reduce((s, p) => s + p.livePct, 0) / scored.length).toFixed(2)),
    daysOpen: Math.max(0, Math.round((Date.parse(today) - Date.parse(board.date)) / 86400000)),
  };
  console.log(`  ${board.horizon}: live ${board.liveRecord.ahead}↑/${board.liveRecord.behind}↓  avg ${board.liveRecord.avgPct > 0 ? '+' : ''}${board.liveRecord.avgPct}% vs ${BENCHMARK_SYMBOL}  (day ${board.liveRecord.daysOpen})`);
  return board;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Which boards are due, based on the AGE of the board currently published —
 * not on today's calendar date.
 *
 * The obvious version ("weekly on Monday, monthly on the 1st") silently skips a
 * whole period whenever a run fails. Miss one Monday and the weekly board sits
 * stale and ungraded for a fortnight; miss the 1st and the monthly board is
 * frozen for two months. GitHub's scheduler is unreliable enough — measured
 * 2h24m to 4h47m late on the sibling repo — that assuming a run happens on an
 * exact date is not safe.
 *
 * Age-based is self-healing: a missed Monday regenerates on Tuesday, and the
 * holding period is recorded on the board itself so grading stays honest about
 * how long each pick actually ran.
 *
 * Crypto never closes, so every day is a trading day.
 */
function boardsDue(now, current) {
  const today = now.toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
  const due = [];

  // Daily: any day the published board isn't from today.
  if (current.daily?.date !== today) due.push('daily');

  // Weekly: prefer Monday, but regenerate regardless once 7 days have elapsed.
  const w = current.weekly;
  if (!w?.date) due.push('weekly');
  else if (w.date !== today && (now.getUTCDay() === 1 || daysBetween(w.date, today) >= 7)) due.push('weekly');

  // Monthly: prefer the 1st, but regenerate on any day in a later month.
  const m = current.monthly;
  if (!m?.date) due.push('monthly');
  else if (m.date.slice(0, 7) !== today.slice(0, 7)) due.push('monthly');

  return due;
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const current = await readJson(PICKS_FILE, {});
  const archive = await readJson(ARCHIVE_FILE, { boards: [] });

  const due = process.env.PICKS_ONLY_HORIZON
    ? process.env.PICKS_ONLY_HORIZON.split(',').map((s) => s.trim())
    : boardsDue(now, current);

  console.log(`Catalyst crypto picks — ${dateStr}`);
  console.log(`  price provider: ${providerName()}`);
  console.log(`  boards due: ${due.join(', ')}`);

  const universe = universeFor(CATEGORY_KEYS);
  console.log(`  universe: ${universe.length} coins`);
  const markets = await getMarkets(universe.map(([id]) => id));
  console.log(`  market data for ${Object.keys(markets).length} coins`);
  if (!Object.keys(markets).length) throw new Error('No market data — aborting rather than publishing a blind board');

  for (const horizon of due) {
    const prev = current[horizon];
    if (prev?.picks?.length) {
      console.log(`\nGrading previous ${horizon} board (${prev.date})…`);
      const graded = await gradeBoard(prev, dateStr, markets);
      if (graded.gradedAt) archive.boards.push(graded);
    }

    console.log(`\nGenerating ${horizon} board…`);
    const picks = await generateBoard(horizon, CATEGORY_KEYS, BOARD_SIZE[horizon], dateStr, markets);
    if (!picks.length) {
      console.log(`  no ${horizon} picks generated — leaving previous board in place`);
      continue;
    }
    current[horizon] = {
      horizon, date: dateStr, generatedAt: new Date().toISOString(),
      benchmarkEntry: markets[BENCHMARK_ID]?.price ?? null,
      picks,
    };
    console.log(`  ✓ ${picks.length}: ${picks.map((p) => `${p.symbol} ${p.direction}`).join(', ')}`);
  }

  // Mark every open board to market, including the ones not regenerated today.
  // This is what keeps the weekly and monthly boards showing current performance
  // instead of sitting blank until the day they are replaced.
  console.log('\nUpdating live performance…');
  for (const horizon of ['daily', 'weekly', 'monthly']) {
    if (current[horizon]?.picks?.length) markToMarket(current[horizon], markets, dateStr);
  }

  // Keep the archive complete. A track record with losers removed is worse than
  // no track record — users can verify every one of these against any chart.
  archive.boards = archive.boards.slice(-500);
  archive.updatedAt = new Date().toISOString();
  archive.attribution = 'Powered by CoinGecko';

  await writeFile(PICKS_FILE, JSON.stringify(current, null, 2));
  await writeFile(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
  console.log(`\nWrote ${PICKS_FILE} and ${ARCHIVE_FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
