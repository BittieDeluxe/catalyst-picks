/**
 * The universe Catalyst picks from, grouped by sector.
 *
 * Ticker symbols and sector classifications are public facts, not market data,
 * so nothing here is licensed — the licence question only bites on prices.
 *
 * Deliberately curated rather than the full S&P 500. Picks are only useful on
 * names liquid enough that a retail user can actually trade them at the price
 * they see, and a smaller universe keeps the research prompt focused. Roughly
 * 25 per sector is enough breadth for a 1-10 pick request without burying the
 * model in a list it has no real view on.
 */

export const SECTORS = {
  tech: {
    label: 'Technology',
    tickers: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD', 'ADBE', 'CSCO', 'ACN',
              'INTU', 'TXN', 'QCOM', 'IBM', 'NOW', 'AMAT', 'MU', 'ADI', 'LRCX', 'KLAC',
              'PANW', 'SNPS', 'CDNS', 'ANET', 'SMCI'],
  },
  semis: {
    label: 'Semiconductors',
    tickers: ['NVDA', 'AMD', 'AVGO', 'TSM', 'MU', 'INTC', 'QCOM', 'TXN', 'ADI', 'AMAT',
              'LRCX', 'KLAC', 'MRVL', 'NXPI', 'ON', 'MCHP', 'SWKS', 'TER', 'ASML', 'ARM'],
  },
  energy: {
    label: 'Energy',
    tickers: ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'PSX', 'VLO', 'OXY', 'WMB',
              'KMI', 'HAL', 'DVN', 'HES', 'BKR', 'FANG', 'TRGP', 'OKE', 'CTRA', 'MRO'],
  },
  healthcare: {
    label: 'Healthcare',
    tickers: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'PFE', 'AMGN',
              'ISRG', 'BSX', 'VRTX', 'SYK', 'GILD', 'CI', 'MDT', 'REGN', 'ELV', 'HCA'],
  },
  financials: {
    label: 'Financials',
    tickers: ['BRK-B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'AXP', 'SPGI',
              'BLK', 'C', 'SCHW', 'CB', 'PGR', 'MMC', 'COF', 'PYPL', 'USB', 'PNC'],
  },
  consumer: {
    label: 'Consumer',
    tickers: ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'LOW', 'SBUX', 'TJX', 'BKNG', 'ABNB',
              'CMG', 'ORLY', 'MAR', 'GM', 'F', 'LULU', 'DKNG', 'RCL', 'YUM', 'DASH'],
  },
  staples: {
    label: 'Consumer Staples',
    tickers: ['WMT', 'COST', 'PG', 'KO', 'PEP', 'PM', 'MO', 'MDLZ', 'CL', 'TGT',
              'KMB', 'GIS', 'SYY', 'KR', 'STZ', 'HSY', 'KHC', 'DG', 'ADM', 'KDP'],
  },
  industrials: {
    label: 'Industrials',
    tickers: ['GE', 'CAT', 'RTX', 'UNP', 'HON', 'BA', 'LMT', 'DE', 'UPS', 'ETN',
              'ADP', 'NOC', 'GD', 'CSX', 'WM', 'ITW', 'EMR', 'FDX', 'NSC', 'PH'],
  },
  communication: {
    label: 'Communication',
    tickers: ['GOOGL', 'META', 'NFLX', 'DIS', 'CMCSA', 'T', 'VZ', 'TMUS', 'CHTR', 'EA',
              'TTWO', 'WBD', 'OMC', 'LYV', 'RBLX', 'SPOT', 'PINS', 'SNAP', 'MTCH', 'TTD'],
  },
  utilities: {
    label: 'Utilities',
    tickers: ['NEE', 'SO', 'DUK', 'CEG', 'AEP', 'SRE', 'D', 'PCG', 'EXC', 'XEL',
              'ED', 'PEG', 'WEC', 'ES', 'AWK', 'DTE', 'AEE', 'PPL', 'FE', 'ETR'],
  },
  realestate: {
    label: 'Real Estate',
    tickers: ['PLD', 'AMT', 'EQIX', 'WELL', 'SPG', 'PSA', 'O', 'CCI', 'DLR', 'CBRE',
              'EXR', 'VICI', 'AVB', 'IRM', 'EQR', 'SBAC', 'INVH', 'MAA', 'ESS', 'ARE'],
  },
  materials: {
    label: 'Materials',
    tickers: ['LIN', 'SHW', 'APD', 'ECL', 'FCX', 'NEM', 'NUE', 'DOW', 'DD', 'PPG',
              'VMC', 'MLM', 'IFF', 'ALB', 'STLD', 'CF', 'LYB', 'CTVA', 'PKG', 'IP'],
  },
};

/** Sector keys a user may request. */
export const SECTOR_KEYS = Object.keys(SECTORS);

/** Max sectors in one Generate request — keeps the research prompt coherent. */
export const MAX_SECTORS_PER_REQUEST = 3;

/** Max picks a single request may ask for. */
export const MAX_PICKS = 10;

/** Deduplicated ticker universe for a set of sector keys. */
export function universeFor(sectorKeys) {
  const seen = new Set();
  for (const k of sectorKeys) {
    for (const t of SECTORS[k]?.tickers ?? []) seen.add(t);
  }
  return [...seen];
}

/** Human label, falling back to the raw key so unknown sectors still render. */
export function labelFor(key) {
  return SECTORS[key]?.label ?? key;
}
