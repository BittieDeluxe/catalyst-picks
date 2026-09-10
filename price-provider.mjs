/**
 * Closing-price lookup, isolated behind one interface.
 *
 * This file exists because the licensing question is unresolved, not because the
 * code needs an abstraction for its own sake. Every vendor's self-serve tier
 * forbids showing data to end users; commercial quotes are out with
 * marketdata.app, Finnhub and Tiingo. Whichever answers cheapest, swapping to it
 * should mean writing one function below and changing PRICE_PROVIDER — nothing
 * else in the pipeline touches a vendor API.
 *
 * Grading MUST use a real feed. Gemini cannot do this job — measured 2026-09-10
 * against Nasdaq's own closes for 2026-09-09, asking three times with search
 * grounding on:
 *
 *     AAPL  315.34   correct x3
 *     MSFT  491.65   correct, correct, WRONG (493.95 — off $2.30 / 0.47%)
 *     NVDA  223.67   correct, WRONG (224.17 — off $0.50 / 0.22%), correct
 *     AMD   521.095  correct x3
 *     TSLA  367.81   correct x3
 *
 * Two of fifteen answers were simply false, and nothing in the response
 * distinguishes them from the true ones. A day-trade moves 1-3%, so a 0.47%
 * error is a third of the signal — enough to report a loser as a winner.
 */

const PROVIDER = process.env.PRICE_PROVIDER ?? 'nasdaq';

const UA = { 'User-Agent': 'curl/8.7.1', Accept: '*/*' };

/** ISO date (YYYY-MM-DD) -> unix seconds at UTC midnight. */
function toEpoch(day) {
  return Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
}

// ---------------------------------------------------------------------------
// Providers. Each returns { [YYYY-MM-DD]: close } for the requested range, or
// null if the lookup failed. Never throw — a failed grade is recoverable, a
// crashed pipeline is not.
// ---------------------------------------------------------------------------

/**
 * DEVELOPMENT ONLY — Nasdaq's public website endpoint.
 *
 * Chosen over Yahoo because Yahoo hard-429s this machine within a few requests,
 * which is exactly the fragility we should not ship on. Still unlicensed for
 * end-user display: replace before anyone can subscribe.
 */
async function nasdaqCloses(ticker, fromDay, toDay) {
  const us = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/historical`
    + `?assetclass=stocks&fromdate=${fromDay}&todate=${toDay}&limit=200`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const rows = (await res.json())?.data?.tradesTable?.rows;
    if (!Array.isArray(rows)) return null;
    const out = {};
    for (const r of rows) {
      const close = Number(String(r.close ?? '').replace(/[$,]/g, ''));
      const [mm, dd, yyyy] = String(r.date ?? '').split('/');
      if (!yyyy || !Number.isFinite(close)) continue;
      out[`${yyyy}-${mm}-${dd}`] = close;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * DEVELOPMENT ONLY. Unofficial, unlicensed, and aggressively rate-limited —
 * kept only as a second option if Nasdaq's endpoint changes shape.
 */
async function yahooCloses(ticker, fromDay, toDay) {
  const p1 = toEpoch(fromDay);
  const p2 = toEpoch(toDay) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`
    + `?period1=${p1}&period2=${p2}&interval=1d`;
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const r = (await res.json())?.chart?.result?.[0];
    const stamps = r?.timestamp;
    const closes = r?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(stamps) || !Array.isArray(closes)) return null;
    const out = {};
    for (let i = 0; i < stamps.length; i++) {
      if (closes[i] == null) continue;
      out[new Date(stamps[i] * 1000).toISOString().slice(0, 10)] = Number(closes[i].toFixed(4));
    }
    return out;
  } catch {
    return null;
  }
}

/** marketdata.app — Commercial tier is the one that permits end-user display. */
async function marketdataCloses(ticker, fromDay, toDay) {
  const key = process.env.MARKETDATA_TOKEN;
  if (!key) return null;
  const url = `https://api.marketdata.app/v1/stocks/candles/D/${encodeURIComponent(ticker)}`
    + `?from=${fromDay}&to=${toDay}&token=${key}`;
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!Array.isArray(d?.t) || !Array.isArray(d?.c)) return null;
    const out = {};
    for (let i = 0; i < d.t.length; i++) {
      out[new Date(d.t[i] * 1000).toISOString().slice(0, 10)] = Number(d.c[i]);
    }
    return out;
  } catch {
    return null;
  }
}

/** Finnhub — cheapest vendor with a published commercial range. */
async function finnhubCloses(ticker, fromDay, toDay) {
  const key = process.env.FINNHUB_TOKEN;
  if (!key) return null;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}`
    + `&resolution=D&from=${toEpoch(fromDay)}&to=${toEpoch(toDay) + 86400}&token=${key}`;
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (d?.s !== 'ok' || !Array.isArray(d.t) || !Array.isArray(d.c)) return null;
    const out = {};
    for (let i = 0; i < d.t.length; i++) {
      out[new Date(d.t[i] * 1000).toISOString().slice(0, 10)] = Number(d.c[i]);
    }
    return out;
  } catch {
    return null;
  }
}

/** Tiingo — flat-rate redistribution licence rather than per-user. */
async function tiingoCloses(ticker, fromDay, toDay) {
  const key = process.env.TIINGO_TOKEN;
  if (!key) return null;
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices`
    + `?startDate=${fromDay}&endDate=${toDay}&token=${key}`;
  try {
    const res = await fetch(url, { headers: { ...UA, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    const out = {};
    for (const r of rows) {
      if (r?.date && r?.close != null) out[String(r.date).slice(0, 10)] = Number(r.close);
    }
    return out;
  } catch {
    return null;
  }
}

const PROVIDERS = {
  nasdaq: nasdaqCloses,
  yahoo: yahooCloses,
  marketdata: marketdataCloses,
  finnhub: finnhubCloses,
  tiingo: tiingoCloses,
};

/** True when the configured provider is not licensed for end-user display. */
export function providerIsDevOnly() {
  return PROVIDER === 'nasdaq' || PROVIDER === 'yahoo';
}

export function providerName() {
  return PROVIDER;
}

/**
 * Daily closes for one ticker across a date range, inclusive.
 * Returns {} rather than null on failure so callers can treat "no data" and
 * "lookup failed" the same way — both mean "cannot grade this pick yet".
 */
export async function getCloses(ticker, fromDay, toDay) {
  const fn = PROVIDERS[PROVIDER];
  if (!fn) throw new Error(`Unknown PRICE_PROVIDER: ${PROVIDER}`);
  return (await fn(ticker, fromDay, toDay)) ?? {};
}

/** Close on a specific day, or null when the market was shut or data is missing. */
export async function getClose(ticker, day) {
  const closes = await getCloses(ticker, day, day);
  return closes[day] ?? null;
}

/**
 * Percentage change between two closes.
 * Both sides must be real numbers — a missing close returns null rather than
 * guessing, because a wrong grade is worse than an ungraded pick.
 */
export function pctChange(from, to) {
  if (typeof from !== 'number' || typeof to !== 'number' || from === 0) return null;
  return Number((((to - from) / from) * 100).toFixed(2));
}
