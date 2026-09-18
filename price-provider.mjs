/**
 * Crypto price lookup.
 *
 * CoinGecko, and the licensing is the reason this app exists in crypto rather
 * than equities. Their terms say plainly: "You're entitled to charge for your
 * services and products that incorporate or integrate data from CoinGecko API."
 * What is forbidden is reselling ACCESS to the API — not displaying the data in
 * a paid app. That is the opposite of every US equities vendor, all of whom bar
 * showing derived values to end users without a redistribution licence
 * ($150-1500/month, or Databento's $1500 + exchange fees).
 *
 * Free "Demo" tier: 10,000 calls/month, attribution REQUIRED. Grading a few
 * dozen coins a day is nowhere near that ceiling. Basic is $35/month
 * ($29 annual) if volume ever justifies it.
 *
 * ATTRIBUTION: the app must display "Data provided by CoinGecko" with a link.
 * That is a condition of the licence, not a nicety — do not remove it.
 *
 * Never grade with an LLM. Measured 2026-09-10 against Nasdaq's own closes,
 * Gemini with search grounding returned two false prices out of fifteen, off by
 * up to 0.47%, with nothing marking the wrong ones.
 */

const BASE = 'https://api.coingecko.com/api/v3';
const KEY = process.env.COINGECKO_API_KEY ?? null;

function headers() {
  return {
    Accept: 'application/json',
    'User-Agent': 'catalyst-picks',
    ...(KEY ? { 'x-cg-demo-api-key': KEY } : {}),
  };
}

/** CoinGecko's history endpoint wants DD-MM-YYYY, not ISO. */
function toCgDate(day) {
  const [y, m, d] = day.split('-');
  return `${d}-${m}-${y}`;
}

/** Free tier is rate limited; space calls out rather than burst and get 429'd. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, { retries = 3 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(20000) });
      if (res.status === 429) {
        // Demo tier throttles hard. Back off rather than lose the run.
        await sleep(attempt * 8000);
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt === retries) return null;
      await sleep(attempt * 2000);
    }
  }
  return null;
}

/**
 * Current market snapshot for a set of CoinGecko ids.
 * One call covers the whole universe, which matters on a 10k/month budget.
 * Returns { id: { symbol, name, price, change24h, change7d, marketCap, volume } }.
 */
export async function getMarkets(ids) {
  const out = {};
  // CoinGecko caps ids per request; chunk defensively.
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const url = `${BASE}/coins/markets?vs_currency=usd&ids=${slice.join(',')}`
      + `&order=market_cap_desc&per_page=${CHUNK}&page=1`
      + `&price_change_percentage=24h,7d`;
    const data = await getJson(url);
    if (!Array.isArray(data)) continue;
    for (const c of data) {
      out[c.id] = {
        symbol: String(c.symbol ?? '').toUpperCase(),
        name: c.name,
        price: c.current_price,
        change24h: c.price_change_percentage_24h,
        change7d: c.price_change_percentage_7d_in_currency,
        marketCap: c.market_cap,
        volume: c.total_volume,
      };
    }
    if (i + CHUNK < ids.length) await sleep(2000);
  }
  return out;
}

/**
 * Price for one coin on a specific past date (UTC).
 *
 * CoinGecko's /history endpoint is the snapshot at 00:00 UTC on that date.
 * Crypto trades 24/7 so there is no "close" — 00:00 UTC is the convention this
 * project uses on both ends of a grade, which keeps the comparison consistent
 * even though it is arbitrary. Do not mix it with spot prices.
 */
export async function getPriceOn(id, day) {
  const data = await getJson(`${BASE}/coins/${encodeURIComponent(id)}/history?date=${toCgDate(day)}&localization=false`);
  const p = data?.market_data?.current_price?.usd;
  return typeof p === 'number' ? p : null;
}

/** Percentage change, or null when either side is missing. Never guesses. */
export function pctChange(from, to) {
  if (typeof from !== 'number' || typeof to !== 'number' || from === 0) return null;
  return Number((((to - from) / from) * 100).toFixed(2));
}

export function providerName() {
  return KEY ? 'coingecko (demo key)' : 'coingecko (keyless)';
}
