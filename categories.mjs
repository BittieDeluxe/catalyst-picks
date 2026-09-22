/**
 * The crypto universe Catalyst picks from, grouped by category.
 *
 * CoinGecko ids (not tickers) because that is what the API keys on. Symbols are
 * carried alongside for display — several distinct coins share a ticker, so the
 * id is the only safe identifier.
 *
 * Deliberately excludes stablecoins. A pick on USDT is not a pick.
 */

export const CATEGORIES = {
  majors: {
    label: 'Majors',
    coins: [
      ['bitcoin', 'BTC'], ['ethereum', 'ETH'], ['solana', 'SOL'], ['binancecoin', 'BNB'],
      ['ripple', 'XRP'], ['cardano', 'ADA'], ['avalanche-2', 'AVAX'], ['polkadot', 'DOT'],
      ['chainlink', 'LINK'], ['litecoin', 'LTC'],
    ],
  },
  layer1: {
    label: 'Layer 1s',
    coins: [
      ['ethereum', 'ETH'], ['solana', 'SOL'], ['cardano', 'ADA'], ['avalanche-2', 'AVAX'],
      ['near', 'NEAR'], ['aptos', 'APT'], ['sui', 'SUI'], ['sei-network', 'SEI'],
      ['injective-protocol', 'INJ'], ['celestia', 'TIA'], ['polkadot', 'DOT'], ['cosmos', 'ATOM'],
    ],
  },
  layer2: {
    label: 'Layer 2s',
    coins: [
      ['matic-network', 'POL'], ['arbitrum', 'ARB'], ['optimism', 'OP'], ['immutable-x', 'IMX'],
      ['mantle', 'MNT'], ['starknet', 'STRK'], ['zksync', 'ZK'], ['metis-token', 'METIS'],
    ],
  },
  defi: {
    label: 'DeFi',
    coins: [
      ['uniswap', 'UNI'], ['aave', 'AAVE'], ['maker', 'MKR'], ['lido-dao', 'LDO'],
      ['curve-dao-token', 'CRV'], ['pendle', 'PENDLE'], ['ethena', 'ENA'], ['jupiter-exchange-solana', 'JUP'],
      // SNX's CoinGecko id is still 'havven', its pre-rebrand name.
      ['raydium', 'RAY'], ['compound-governance-token', 'COMP'], ['havven', 'SNX'],
    ],
  },
  ai: {
    label: 'AI & Compute',
    coins: [
      ['render-token', 'RNDR'], ['fetch-ai', 'FET'], ['bittensor', 'TAO'], ['akash-network', 'AKT'],
      ['the-graph', 'GRT'], ['arweave', 'AR'], ['filecoin', 'FIL'], ['worldcoin-wld', 'WLD'],
    ],
  },
  memes: {
    label: 'Memecoins',
    coins: [
      ['dogecoin', 'DOGE'], ['shiba-inu', 'SHIB'], ['pepe', 'PEPE'], ['bonk', 'BONK'],
      ['dogwifcoin', 'WIF'], ['floki', 'FLOKI'], ['book-of-meme', 'BOME'],
    ],
  },
  exchange: {
    label: 'Exchange & RWA',
    coins: [
      ['binancecoin', 'BNB'], ['okb', 'OKB'], ['crypto-com-chain', 'CRO'], ['kucoin-shares', 'KCS'],
      ['ondo-finance', 'ONDO'], ['chainlink', 'LINK'], ['quant-network', 'QNT'],
    ],
  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

/** Max categories in one Generate request. */
export const MAX_CATEGORIES_PER_REQUEST = 3;

/** Max picks a single request may ask for. */
export const MAX_PICKS = 10;

/** The benchmark every pick is measured against. See gradeBoard. */
export const BENCHMARK_ID = 'bitcoin';
export const BENCHMARK_SYMBOL = 'BTC';

/**
 * Deduplicated [id, symbol] universe for a set of category keys.
 *
 * The benchmark itself is never pickable. Every pick is scored as its move
 * minus the benchmark's move over the same window, so a pick ON the benchmark
 * evaluates to exactly zero forever — it can never win, lose, or push, and it
 * occupies a slot on the board while saying nothing. It still has to stay in
 * the CATEGORIES list because prices for it are fetched the same way and it is
 * what every other pick is measured against.
 */
export function universeFor(categoryKeys, { includeBenchmark = false } = {}) {
  const seen = new Map();
  for (const k of categoryKeys) {
    for (const [id, sym] of CATEGORIES[k]?.coins ?? []) seen.set(id, sym);
  }
  if (!includeBenchmark) seen.delete(BENCHMARK_ID);
  return [...seen.entries()];
}

export function labelFor(key) {
  return CATEGORIES[key]?.label ?? key;
}

/** CoinGecko id -> display symbol, across every category. */
export function symbolFor(id) {
  for (const c of Object.values(CATEGORIES)) {
    for (const [cid, sym] of c.coins) if (cid === id) return sym;
  }
  return id;
}

/**
 * Resolve whatever the model wrote back to a CoinGecko id.
 *
 * Asked for the id, Gemini variously returns the id ("uniswap"), the ticker
 * ("UNI"), or both ("UNI (uniswap)"). All three mean the same coin, and
 * rejecting the last two threw away good picks — an early run lost 4 of 6 that
 * way. Only reject genuinely unknown coins.
 */
export function resolveId(raw, allowedIds) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();

  // "uni (uniswap)" or "uniswap (uni)" — try whatever is in the parentheses first.
  const paren = s.match(/\(([^)]+)\)/);
  const candidates = [paren?.[1]?.trim(), s.replace(/\s*\([^)]*\)\s*/, '').trim(), s].filter(Boolean);

  for (const c of candidates) {
    if (allowedIds.has(c)) return c;
  }
  // Fall back to a ticker lookup within the allowed set.
  for (const c of candidates) {
    for (const cat of Object.values(CATEGORIES)) {
      for (const [cid, sym] of cat.coins) {
        if (allowedIds.has(cid) && sym.toLowerCase() === c) return cid;
      }
    }
  }
  return null;
}
