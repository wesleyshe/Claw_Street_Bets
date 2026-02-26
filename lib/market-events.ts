import { MarketSentiment } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type CoinFocus = {
  coinId: "bitcoin" | "ethereum" | "solana" | "avalanche-2" | "dogecoin" | "shiba-inu" | "ripple";
  symbol: "BTC" | "ETH" | "SOL" | "AVAX" | "DOGE" | "SHIB" | "XRP";
};

type MarketEventPayload = {
  id: string;
  headline: string;
  body: string;
  sentiment: MarketSentiment;
  coinId: string | null;
  createdAt: string;
  expiresAt: string;
};

const COIN_FOCUS: CoinFocus[] = [
  { coinId: "bitcoin", symbol: "BTC" },
  { coinId: "ethereum", symbol: "ETH" },
  { coinId: "solana", symbol: "SOL" },
  { coinId: "avalanche-2", symbol: "AVAX" },
  { coinId: "dogecoin", symbol: "DOGE" },
  { coinId: "shiba-inu", symbol: "SHIB" },
  { coinId: "ripple", symbol: "XRP" }
];

const COIN_ALIASES: Record<CoinFocus["coinId"], string[]> = {
  bitcoin: ["bitcoin", "btc"],
  ethereum: ["ethereum", "eth", "ether"],
  solana: ["solana", "sol"],
  "avalanche-2": ["avalanche", "avax"],
  dogecoin: ["dogecoin", "doge"],
  "shiba-inu": ["shiba inu", "shib"],
  ripple: ["ripple", "xrp"]
};

const LIVE_NEWS_TTL_MS = 90_000;
const LIVE_NEWS_LIMIT = 8;
const LIVE_NEWS_EVENT_LIFETIME_MS = 90 * 60 * 1000;
const GOOGLE_NEWS_URL = (() => {
  const query =
    "(bitcoin OR btc OR ethereum OR eth OR solana OR sol OR avalanche OR avax OR dogecoin OR doge OR shiba inu OR shib OR ripple OR xrp) crypto";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
})();

type LiveNewsState = {
  cache: MarketEventPayload[];
  lastUpdated: number | null;
  refreshPromise: Promise<void> | null;
};

declare global {
  var __csbLiveNewsState: LiveNewsState | undefined;
}

function getLiveNewsState(): LiveNewsState {
  if (!globalThis.__csbLiveNewsState) {
    globalThis.__csbLiveNewsState = {
      cache: [],
      lastUpdated: null,
      refreshPromise: null
    };
  }
  return globalThis.__csbLiveNewsState;
}

const MACRO_TEMPLATES = [
  {
    sentiment: MarketSentiment.BULL,
    headline: "Macro Risk-On Pulse",
    body: "Desk rumor: liquidity conditions are improving and traders expect broad risk assets to grind higher."
  },
  {
    sentiment: MarketSentiment.BEAR,
    headline: "Funding Desk Tightness",
    body: "Whispers of tighter funding and de-risking across leveraged books. Traders may reduce exposure."
  },
  {
    sentiment: MarketSentiment.NEUTRAL,
    headline: "Sideways Session Chatter",
    body: "Rumor mill points to low-conviction positioning. Participants expect chop until a stronger catalyst appears."
  }
];

const COIN_TEMPLATES = [
  {
    sentiment: MarketSentiment.BULL,
    headline: (coin: CoinFocus) => `${coin.symbol} Accumulation Talk`,
    body: (coin: CoinFocus) =>
      `Community chatter suggests steady dip-buying interest in ${coin.symbol}; momentum agents may rotate in.`
  },
  {
    sentiment: MarketSentiment.BEAR,
    headline: (coin: CoinFocus) => `${coin.symbol} Deleveraging Rumor`,
    body: (coin: CoinFocus) =>
      `Rumor: large holders could be reducing ${coin.symbol} risk. Expect caution and faster profit-taking behavior.`
  },
  {
    sentiment: MarketSentiment.NEUTRAL,
    headline: (coin: CoinFocus) => `${coin.symbol} Wait-and-See Tone`,
    body: (coin: CoinFocus) =>
      `Traders are split on ${coin.symbol}; forum sentiment looks balanced with no dominant direction yet.`
  }
];

const NEWSWIRE_TEMPLATES = [
  {
    sentiment: MarketSentiment.BULL,
    headline: "ETF Flow Tracker: Risk Appetite Improving",
    body: "Newswire chatter points to steady spot-ETF inflows, often read by desks as a supportive backdrop for large-cap crypto."
  },
  {
    sentiment: MarketSentiment.BEAR,
    headline: "Rates Desk Alert: Yields Climbing",
    body: "Macro desks report higher Treasury yields and tighter financial conditions, a setup that can pressure high-beta coins."
  },
  {
    sentiment: MarketSentiment.NEUTRAL,
    headline: "Calendar Watch: CPI/Fed Event Risk",
    body: "Traders are waiting for upcoming inflation prints and central-bank commentary before increasing directional exposure."
  },
  {
    sentiment: MarketSentiment.BULL,
    headline: "Policy Talk: Stablecoin Clarity Hopes",
    body: "DC policy headlines continue to discuss stablecoin framework progress, which some traders view as medium-term constructive."
  },
  {
    sentiment: MarketSentiment.BEAR,
    headline: "Exchange Ops Watch: Liquidity Pockets Thin",
    body: "Execution desks mention thinner weekend liquidity and higher slippage pockets, raising the chance of sharp downside wicks."
  },
  {
    sentiment: MarketSentiment.NEUTRAL,
    headline: "Mining + Energy Headlines Mixed",
    body: "Energy-cost and hashrate headlines remain mixed, keeping miners and macro-focused participants in a wait-and-see stance."
  },
  {
    sentiment: MarketSentiment.BULL,
    headline: "Meme Coin Season Signals Rising",
    body: "Social volume on DOGE and SHIB spiking. Community-driven speculation cycles tend to lift broad altcoin exposure."
  },
  {
    sentiment: MarketSentiment.BEAR,
    headline: "Whale Alert: Large Unstaking Detected",
    body: "On-chain watchers flagging large unstaking events across SOL and AVAX validators. Could signal distribution pressure."
  }
];

const BULLISH_TERMS = [
  "surge",
  "rally",
  "soar",
  "jump",
  "breakout",
  "approval",
  "inflow",
  "adoption",
  "partnership",
  "record high",
  "bull"
];

const BEARISH_TERMS = [
  "drop",
  "decline",
  "plunge",
  "selloff",
  "sell-off",
  "ban",
  "hack",
  "breach",
  "exploit",
  "lawsuit",
  "outflow",
  "liquidation",
  "bear"
];

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function sixHourWindowKey(date = new Date()) {
  const block = Math.floor(date.getUTCHours() / 6);
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}-${block}`;
}

function randomInt(rng: () => number, min: number, maxInclusive: number) {
  return Math.floor(rng() * (maxInclusive - min + 1)) + min;
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function unwrapCdata(value: string) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function getTag(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return "";
  return decodeXmlEntities(unwrapCdata(match[1]).trim());
}

function cleanHeadline(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function shortBody(value: string) {
  const text = stripHtml(value).replace(/\s+/g, " ").trim();
  if (text.length <= 220) return text;
  return `${text.slice(0, 217).trimEnd()}...`;
}

function containsToken(text: string, token: string) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function detectCoinId(text: string): CoinFocus["coinId"] | null {
  for (const coin of COIN_FOCUS) {
    const aliases = COIN_ALIASES[coin.coinId];
    if (aliases.some((alias) => containsToken(text, alias))) {
      return coin.coinId;
    }
  }
  return null;
}

function inferSentiment(text: string) {
  const lower = text.toLowerCase();
  let score = 0;

  for (const term of BULLISH_TERMS) {
    if (lower.includes(term)) score += 1;
  }
  for (const term of BEARISH_TERMS) {
    if (lower.includes(term)) score -= 1;
  }

  if (score > 0) return MarketSentiment.BULL;
  if (score < 0) return MarketSentiment.BEAR;
  return MarketSentiment.NEUTRAL;
}

async function fetchLiveCryptoNews(now = new Date()): Promise<MarketEventPayload[]> {
  const response = await fetch(GOOGLE_NEWS_URL, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Google News RSS responded ${response.status}`);
  }

  const xml = await response.text();
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

  const seen = new Set<string>();
  const events: MarketEventPayload[] = [];

  for (const item of itemBlocks) {
    if (events.length >= LIVE_NEWS_LIMIT) break;

    const headline = cleanHeadline(getTag(item, "title"));
    if (!headline) continue;

    const dedupeKey = headline.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const description = getTag(item, "description");
    const pubDate = new Date(getTag(item, "pubDate"));
    const publishedAt = Number.isFinite(pubDate.getTime()) ? pubDate : now;

    const combinedText = `${headline} ${description}`;
    const coinId = detectCoinId(combinedText);
    const sentiment = inferSentiment(combinedText);
    const createdAt = publishedAt.toISOString();
    const expiresAt = new Date(Math.max(publishedAt.getTime(), now.getTime()) + LIVE_NEWS_EVENT_LIFETIME_MS).toISOString();

    events.push({
      id: `live-${publishedAt.getTime()}-${events.length}`,
      headline,
      body: shortBody(description || "Live crypto market update from newswire feeds."),
      sentiment,
      coinId,
      createdAt,
      expiresAt
    });
  }

  if (!events.length) {
    throw new Error("No usable live crypto news items were parsed.");
  }

  return events;
}

async function refreshLiveEvents(now = new Date()): Promise<MarketEventPayload[]> {
  const state = getLiveNewsState();
  if (state.refreshPromise) {
    await state.refreshPromise;
    return state.cache;
  }

  state.refreshPromise = (async () => {
    const events = await fetchLiveCryptoNews(now);
    state.cache = events;
    state.lastUpdated = Date.now();
  })();

  try {
    await state.refreshPromise;
  } finally {
    state.refreshPromise = null;
  }

  return state.cache;
}

async function getLiveEvents(now = new Date()): Promise<MarketEventPayload[]> {
  const state = getLiveNewsState();
  const currentTime = now.getTime();
  const stale = !state.lastUpdated || currentTime - state.lastUpdated >= LIVE_NEWS_TTL_MS;
  if (stale) {
    try {
      return await refreshLiveEvents(now);
    } catch (error) {
      if (!state.cache.length) throw error;
      return state.cache;
    }
  }
  return state.cache;
}

async function generateEventsIfNeeded(now = new Date()) {
  const activeCount = await prisma.marketEvent.count({
    where: { expiresAt: { gt: now } }
  });
  if (activeCount > 0) return;

  const seed = hashString(sixHourWindowKey(now));
  const rng = mulberry32(seed);
  const count = randomInt(rng, 3, 6);
  const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const events = [];

  for (let i = 0; i < count; i += 1) {
    const roll = rng();
    if (roll < 0.55) {
      const coin = COIN_FOCUS[randomInt(rng, 0, COIN_FOCUS.length - 1)];
      const template = COIN_TEMPLATES[randomInt(rng, 0, COIN_TEMPLATES.length - 1)];
      events.push({
        headline: template.headline(coin),
        body: template.body(coin),
        sentiment: template.sentiment,
        coinId: coin.coinId,
        expiresAt
      });
    } else if (roll < 0.78) {
      const template = MACRO_TEMPLATES[randomInt(rng, 0, MACRO_TEMPLATES.length - 1)];
      events.push({
        headline: template.headline,
        body: template.body,
        sentiment: template.sentiment,
        coinId: null,
        expiresAt
      });
    } else {
      const template = NEWSWIRE_TEMPLATES[randomInt(rng, 0, NEWSWIRE_TEMPLATES.length - 1)];
      events.push({
        headline: template.headline,
        body: template.body,
        sentiment: template.sentiment,
        coinId: null,
        expiresAt
      });
    }
  }

  await prisma.marketEvent.createMany({ data: events });
}

export async function getActiveMarketEvents() {
  const liveNow = new Date();
  try {
    const liveEvents = await getLiveEvents(liveNow);
    const activeLive = liveEvents.filter((event) => new Date(event.expiresAt).getTime() > liveNow.getTime());
    if (activeLive.length) {
      return activeLive;
    }
  } catch (error) {
    console.error("[market-events] live feed unavailable, using generated fallback:", error);
  }

  const now = new Date();
  let events = await prisma.marketEvent.findMany({
    where: { expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" }
  });

  if (!events.length) {
    await generateEventsIfNeeded(now);
    events = await prisma.marketEvent.findMany({
      where: { expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" }
    });
  }

  return events.map((event): MarketEventPayload => ({
    id: event.id,
    headline: event.headline,
    body: event.body,
    sentiment: event.sentiment,
    coinId: event.coinId,
    createdAt: event.createdAt.toISOString(),
    expiresAt: event.expiresAt.toISOString()
  }));
}
