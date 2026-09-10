/**
 * Catalyst's scheduled stock picks.
 *
 * Publishes three boards on a fixed schedule — daily, weekly (Mondays) and
 * monthly (first trading day) — and grades the previous board of each horizon
 * against real closing prices before publishing the next one.
 *
 * The fixed schedule is deliberate and not just operational tidiness. The
 * publisher's exclusion that lets newsletters give securities opinions without
 * registering turns on the publication being bona fide, impersonal, and
 * REGULARLY circulated. Every subscriber gets the identical board; nothing here
 * is tailored to anyone's finances. Keep it that way.
 */

import { SECTORS, SECTOR_KEYS, universeFor, labelFor } from './sectors.mjs';
import { getCloses, pctChange, providerName, providerIsDevOnly } from './price-provider.mjs';
import { readFile, writeFile } from 'node:fs/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';

const PICKS_FILE = 'picks.json';
const ARCHIVE_FILE = 'picks-archive.json';

/** Picks published per horizon on the scheduled board. */
const BOARD_SIZE = { daily: 5, weekly: 5, monthly: 5 };

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

/**
 * Grounded call. googleSearch cannot be combined with responseMimeType or
 * responseSchema — the API rejects the pairing — so the JSON contract lives in
 * the prompt and is recovered by tryParseJson below.
 */
async function gemini(prompt, { grounded = true } = {}) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

/** Pull a JSON object out of model text that may carry a reasoning preamble. */
function tryParseJson(raw) {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const HORIZON_BRIEF = {
  daily: 'a single trading session (today\'s open to today\'s close)',
  weekly: 'the coming week (this Monday through Friday\'s close)',
  monthly: 'the coming month',
};

function buildPrompt(horizon, sectorKeys, count, dateStr) {
  const universe = universeFor(sectorKeys);
  const sectorNames = sectorKeys.map(labelFor).join(', ');
  return `You are an equity analyst writing a scheduled market note. Today is ${dateStr}.

Search the web for what is moving these companies right now:
- Earnings dates, guidance changes, and post-earnings drift
- Analyst upgrades/downgrades and price-target changes
- Product launches, regulatory decisions, legal outcomes
- Sector-level catalysts (rates, commodity prices, policy)
- Unusual volume or momentum, and where it came from

Then select the ${count} most compelling ideas for ${HORIZON_BRIEF[horizon]} from
this universe of ${sectorNames} names ONLY:

${universe.join(', ')}

RULES
1. Pick ONLY from the tickers listed above. Never invent a ticker.
2. Every pick needs a concrete, checkable catalyst — a named event, filing,
   report or announcement. "Momentum looks good" is not a catalyst.
3. Direction must be "long" or "short".
4. Do NOT state a target price or a stop. This note is impersonal commentary,
   not instructions for any individual.
5. Do NOT reference portfolio size, allocation, position sizing, or what any
   reader should do with their money.
6. If you cannot find ${count} ideas with a real catalyst, return fewer. An
   honest short list beats padding.

Return ONLY this JSON, no prose:
{
  "picks": [
    {
      "ticker": "NVDA",
      "direction": "long",
      "conviction": "high",
      "catalyst": "one sentence naming the specific event",
      "rationale": "2-3 sentences of reasoning",
      "risk": "one sentence on what would invalidate this"
    }
  ]
}`;
}

async function generateBoard(horizon, sectorKeys, count, dateStr) {
  const prompt = buildPrompt(horizon, sectorKeys, count, dateStr);
  const universe = new Set(universeFor(sectorKeys));

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await gemini(prompt);
      const parsed = tryParseJson(raw);
      const picks = parsed?.picks;
      if (!Array.isArray(picks) || picks.length === 0) {
        console.log(`  attempt ${attempt}: no picks parsed`);
        continue;
      }
      // Drop anything outside the universe — the model occasionally reaches for
      // a name it likes better than the ones it was given.
      const clean = picks.filter((p) => {
        const ok = p?.ticker && universe.has(String(p.ticker).toUpperCase());
        if (!ok) console.log(`  dropped off-universe ticker: ${p?.ticker}`);
        return ok;
      }).map((p) => ({
        ticker: String(p.ticker).toUpperCase(),
        direction: p.direction === 'short' ? 'short' : 'long',
        conviction: ['high', 'medium', 'low'].includes(p.conviction) ? p.conviction : 'medium',
        catalyst: p.catalyst ?? '',
        rationale: p.rationale ?? '',
        risk: p.risk ?? '',
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
 * Grade a board against real closes.
 *
 * METHODOLOGY, stated once here and it must match whatever the app tells users:
 * entry is the close on the day the board was published, exit is the close on
 * the day it is graded. Close-to-close.
 *
 * This is measurable and checkable, but it is not exactly what a reader could
 * have achieved — the board is published after the bell, so the earliest real
 * entry is the next open. Close-to-close is the convention published track
 * records use, and being consistent and disclosed matters more than being
 * flattering. Do not quietly switch to open-to-close later; that would rewrite
 * history.
 *
 * A long is graded on the move from entry to exit; a short is the inverse.
 * Picks whose prices cannot be resolved stay UNGRADED rather than guessed — an
 * ungraded pick is honest, a wrongly graded one destroys the only thing the
 * product sells.
 */
async function gradeBoard(board, exitDay) {
  if (!board?.picks?.length) return board;
  const entryDay = board.date;
  let graded = 0;

  for (const pick of board.picks) {
    if (pick.result) continue;
    const closes = await getCloses(pick.ticker, entryDay, exitDay);
    const entry = closes[entryDay] ?? null;
    const exit = closes[exitDay] ?? null;
    const move = pctChange(entry, exit);
    if (move === null) {
      console.log(`  ${pick.ticker}: no price data for ${entryDay} -> ${exitDay}, left ungraded`);
      continue;
    }
    const signed = pick.direction === 'short' ? -move : move;
    pick.entryClose = entry;
    pick.exitClose = exit;
    pick.exitDate = exitDay;
    pick.changePct = move;
    pick.resultPct = Number(signed.toFixed(2));
    pick.result = signed > 0 ? 'W' : signed < 0 ? 'L' : 'push';
    graded++;
    console.log(`  ${pick.ticker} ${pick.direction}: ${entry} -> ${exit} = ${signed > 0 ? '+' : ''}${signed.toFixed(2)}% ${pick.result}`);
  }

  if (graded) {
    const done = board.picks.filter((p) => p.result);
    board.gradedAt = new Date().toISOString();
    board.record = {
      wins: done.filter((p) => p.result === 'W').length,
      losses: done.filter((p) => p.result === 'L').length,
      avgPct: done.length
        ? Number((done.reduce((s, p) => s + p.resultPct, 0) / done.length).toFixed(2))
        : null,
    };
  }
  return board;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Which boards are cut today.
 *
 * The job runs AFTER the closing bell, because grading needs the session's
 * official close and that does not exist until the market shuts. So each run
 * grades what just closed, then publishes the board for the period ahead.
 *
 * That makes Friday, not Monday, the right day to cut the weekly board — a
 * "week ahead" board published Monday evening has already missed Monday. Same
 * logic puts the monthly board on the last weekday of the month rather than the
 * first.
 */
function boardsDue(now) {
  const dow = now.getUTCDay();      // 0 Sun .. 6 Sat
  const due = [];
  if (dow >= 1 && dow <= 5) due.push('daily');
  if (dow === 5) due.push('weekly');
  if (dow >= 1 && dow <= 5 && isLastWeekdayOfMonth(now)) due.push('monthly');
  return due;
}

/** True when no later weekday remains in this month. */
function isLastWeekdayOfMonth(now) {
  const probe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = probe.getUTCMonth();
  for (;;) {
    probe.setUTCDate(probe.getUTCDate() + 1);
    if (probe.getUTCMonth() !== month) return true;
    const d = probe.getUTCDay();
    if (d >= 1 && d <= 5) return false;
  }
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const due = process.env.PICKS_ONLY_HORIZON
    ? process.env.PICKS_ONLY_HORIZON.split(',').map((s) => s.trim())
    : boardsDue(now);

  console.log(`Catalyst picks — ${dateStr}`);
  console.log(`  price provider: ${providerName()}${providerIsDevOnly() ? '  [DEV ONLY — not licensed for end users]' : ''}`);
  console.log(`  boards due: ${due.join(', ') || '(none — weekend)'}`);
  if (!due.length) return;

  const current = await readJson(PICKS_FILE, {});
  const archive = await readJson(ARCHIVE_FILE, { boards: [] });

  for (const horizon of due) {
    // Grade the outgoing board of this horizon before replacing it.
    const prev = current[horizon];
    if (prev?.picks?.length) {
      console.log(`\nGrading previous ${horizon} board (${prev.date})…`);
      const graded = await gradeBoard(prev, dateStr);
      if (graded.gradedAt) archive.boards.push(graded);
    }

    console.log(`\nGenerating ${horizon} board…`);
    const picks = await generateBoard(horizon, SECTOR_KEYS, BOARD_SIZE[horizon], dateStr);
    if (!picks.length) {
      console.log(`  no ${horizon} picks generated — leaving previous board in place`);
      continue;
    }
    current[horizon] = { horizon, date: dateStr, generatedAt: new Date().toISOString(), picks };
    console.log(`  ✓ ${picks.length} picks: ${picks.map((p) => `${p.ticker} ${p.direction}`).join(', ')}`);
  }

  // Keep the archive complete. A track record with losers removed is worse than
  // no track record — it is the thing regulators look at, and the thing users
  // can check against the market themselves.
  archive.boards = archive.boards.slice(-500);
  archive.updatedAt = new Date().toISOString();

  await writeFile(PICKS_FILE, JSON.stringify(current, null, 2));
  await writeFile(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
  console.log(`\nWrote ${PICKS_FILE} and ${ARCHIVE_FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
