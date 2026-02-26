const COINGECKO_SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const CRYPTOCOMPARE_PRICE_URL = "https://min-api.cryptocompare.com/data/pricemulti";
const COINCAP_ASSETS_URL = "https://api.coincap.io/v2/assets";
const PRICE_TTL_MS = 60_000;
const BACKGROUND_REFRESH_MS = 120_000;

/** 7 highest-volatility coins supported by the game */
export const SUPPORTED_COINS = [
  "bitcoin",
  "ethereum",
  "solana",
  "avalanche-2",
  "dogecoin",
  "shiba-inu",
  "ripple"
] as const;

export type CoinId = (typeof SUPPORTED_COINS)[number];

export const COIN_SYMBOLS: Record<CoinId, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  "avalanche-2": "AVAX",
  dogecoin: "DOGE",
  "shiba-inu": "SHIB",
  ripple: "XRP"
};

type PriceEntry = {
  usd: number;
  fetchedAt: number;
};

type MarketState = {
  cache: Partial<Record<CoinId, PriceEntry>>;
  lastUpdated: number | null;
  lastSource: string | null;
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
      lastSource: null,
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

const COINCAP_IDS: Record<CoinId, string> = {
  bitcoin: "bitcoin",
  ethereum: "ethereum",
  solana: "solana",
  "avalanche-2": "avalanche",
  dogecoin: "dogecoin",
  "shiba-inu": "shiba-inu",
  ripple: "xrp"
};

type PriceMap = Partial<Record<CoinId, number>>;

function applyPriceMap(state: MarketState, priceMap: PriceMap, source: string) {
  const fetchedAt = now();
  let updatedAny = false;

  for (const coinId of SUPPORTED_COINS) {
    const usd = priceMap[coinId];
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
      state.cache[coinId] = { usd, fetchedAt };
      updatedAny = true;
    }
  }

  if (updatedAny) {
    state.lastUpdated = fetchedAt;
    state.lastSource = source;
  }

  return updatedAny;
}

async function fetchFromCoinGecko(): Promise<PriceMap> {
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
  const prices: PriceMap = {};
  for (const coinId of SUPPORTED_COINS) {
    const usd = body[coinId]?.usd;
    if (typeof usd === "number" && Number.isFinite(usd)) {
      prices[coinId] = usd;
    }
  }
  return prices;
}

async function fetchFromCryptoCompare(): Promise<PriceMap> {
  const symbols = SUPPORTED_COINS.map((coinId) => COIN_SYMBOLS[coinId]).join(",");
  const url = `${CRYPTOCOMPARE_PRICE_URL}?fsyms=${encodeURIComponent(symbols)}&tsyms=USD`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`CryptoCompare responded ${response.status}`);
  }

  const body = (await response.json()) as Partial<Record<string, { USD?: number }>>;
  const prices: PriceMap = {};
  for (const coinId of SUPPORTED_COINS) {
    const symbol = COIN_SYMBOLS[coinId];
    const usd = body[symbol]?.USD;
    if (typeof usd === "number" && Number.isFinite(usd)) {
      prices[coinId] = usd;
    }
  }
  return prices;
}

async function fetchFromCoinCap(): Promise<PriceMap> {
  const ids = SUPPORTED_COINS.map((coinId) => COINCAP_IDS[coinId]).join(",");
  const url = `${COINCAP_ASSETS_URL}?ids=${encodeURIComponent(ids)}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`CoinCap responded ${response.status}`);
  }

  const body = (await response.json()) as { data?: Array<{ id?: string; priceUsd?: string }> };
  const byCoinCapId = new Map<string, number>();

  for (const row of body.data ?? []) {
    if (!row.id || typeof row.priceUsd !== "string") continue;
    const parsed = Number(row.priceUsd);
    if (Number.isFinite(parsed) && parsed > 0) {
      byCoinCapId.set(row.id, parsed);
    }
  }

  const prices: PriceMap = {};
  for (const coinId of SUPPORTED_COINS) {
    const coinCapId = COINCAP_IDS[coinId];
    const usd = byCoinCapId.get(coinCapId);
    if (typeof usd === "number") {
      prices[coinId] = usd;
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
    const providers: Array<{ source: string; fetcher: () => Promise<PriceMap> }> = [
      { source: "coingecko", fetcher: fetchFromCoinGecko },
      { source: "cryptocompare", fetcher: fetchFromCryptoCompare },
      { source: "coincap", fetcher: fetchFromCoinCap }
    ];
    const errors: string[] = [];

    for (const provider of providers) {
      try {
        const priceMap = await provider.fetcher();
        if (applyPriceMap(state, priceMap, provider.source)) {
          return;
        }
        errors.push(`${provider.source}: no usable prices`);
      } catch (error) {
        errors.push(`${provider.source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`All price providers failed (${errors.join(" | ")})`);
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
    void refreshAll().catch(() => {});
  }, BACKGROUND_REFRESH_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  void refreshAll().catch(() => {});
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
        warning = "Live market fetch failed. Returning last known cached prices.";
      } else {
        throw new Error("Unable to fetch prices and no cached data exists.");
      }
    }
  }

  return {
    prices: buildPricesSnapshot(state),
    lastUpdated: state.lastUpdated ? new Date(state.lastUpdated).toISOString() : null,
    source: state.lastSource ?? "unknown",
    warning
  };
}
