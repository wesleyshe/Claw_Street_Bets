const COINGECKO_SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const PRICE_TTL_MS = 60_000;
const BACKGROUND_REFRESH_MS = 120_000;

export const SUPPORTED_COINS = [
  "bitcoin",
  "ethereum",
  "solana",
  "avalanche-2",
  "cardano",
  "dogecoin",
  "shiba-inu",
  "ripple",
  "chainlink",
  "uniswap"
] as const;

export type CoinId = (typeof SUPPORTED_COINS)[number];

export const COIN_SYMBOLS: Record<CoinId, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  "avalanche-2": "AVAX",
  cardano: "ADA",
  dogecoin: "DOGE",
  "shiba-inu": "SHIB",
  ripple: "XRP",
  chainlink: "LINK",
  uniswap: "UNI"
};

type PriceEntry = {
  usd: number;
  fetchedAt: number;
};

type MarketState = {
  cache: Partial<Record<CoinId, PriceEntry>>;
  lastUpdated: number | null;
  refreshPromise: Promise<void> | null;
  backgroundStarted: boolean;
};

declare global {
  var __csbMarketState: MarketState | undefined;
}

function getState(): MarketState {
  if (!globalThis.__csbMarketState) {
    globalThis.__csbMarketState = {
      cache: {},
      lastUpdated: null,
      refreshPromise: null,
      backgroundStarted: false
    };
  }

  return globalThis.__csbMarketState;
}

function now() {
  return Date.now();
}

function isFresh(entry: PriceEntry | undefined, at: number) {
  return Boolean(entry && at - entry.fetchedAt < PRICE_TTL_MS);
}

function hasAnyPrices(state: MarketState) {
  return SUPPORTED_COINS.some((coinId) => Boolean(state.cache[coinId]));
}

function allCoinsFresh(state: MarketState, at: number) {
  return SUPPORTED_COINS.every((coinId) => isFresh(state.cache[coinId], at));
}

function buildPricesSnapshot(state: MarketState) {
  const prices: Partial<Record<CoinId, { usd: number }>> = {};
  for (const coinId of SUPPORTED_COINS) {
    const entry = state.cache[coinId];
    if (entry) {
      prices[coinId] = { usd: entry.usd };
    }
  }
  return prices;
}

export async function refreshAll() {
  const state = getState();
  if (state.refreshPromise) {
    return state.refreshPromise;
  }

  state.refreshPromise = (async () => {
    const ids = SUPPORTED_COINS.join(",");
    const url = `${COINGECKO_SIMPLE_PRICE_URL}?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`CoinGecko responded ${response.status}`);
    }

    const body = (await response.json()) as Partial<Record<CoinId, { usd?: number }>>;
    const fetchedAt = now();
    let updatedAny = false;

    for (const coinId of SUPPORTED_COINS) {
      const usd = body[coinId]?.usd;
      if (typeof usd === "number" && Number.isFinite(usd)) {
        state.cache[coinId] = { usd, fetchedAt };
        updatedAny = true;
      }
    }

    if (updatedAny) {
      state.lastUpdated = fetchedAt;
    } else {
      throw new Error("CoinGecko response did not contain usable prices.");
    }
  })();

  try {
    await state.refreshPromise;
  } finally {
    state.refreshPromise = null;
  }
}

export function ensureMarketBackgroundRefresh() {
  const state = getState();
  if (state.backgroundStarted) return;

  state.backgroundStarted = true;
  const timer = setInterval(() => {
    void refreshAll().catch(() => {
      // Keep last known prices and retry on next cycle.
    });
  }, BACKGROUND_REFRESH_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  // Warm cache early without blocking requests.
  void refreshAll().catch(() => {
    // If startup fetch fails, requests can still try later.
  });
}

export async function getMarketPrices() {
  ensureMarketBackgroundRefresh();
  const state = getState();
  let warning: string | undefined;

  const requestTime = now();
  if (!allCoinsFresh(state, requestTime)) {
    try {
      await refreshAll();
    } catch {
      if (hasAnyPrices(state)) {
        warning = "CoinGecko unavailable. Returning last known cached prices.";
      } else {
        throw new Error("Unable to fetch prices and no cached data exists.");
      }
    }
  }

  return {
    prices: buildPricesSnapshot(state),
    lastUpdated: state.lastUpdated ? new Date(state.lastUpdated).toISOString() : null,
    source: "coingecko" as const,
    warning
  };
}
