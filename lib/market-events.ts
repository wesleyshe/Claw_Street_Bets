import { MarketSentiment } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type CoinFocus = {
  coinId: "bitcoin" | "ethereum" | "solana" | "dogecoin";
  symbol: "BTC" | "ETH" | "SOL" | "DOGE";
};

const COIN_FOCUS: CoinFocus[] = [
  { coinId: "bitcoin", symbol: "BTC" },
  { coinId: "ethereum", symbol: "ETH" },
  { coinId: "solana", symbol: "SOL" },
  { coinId: "dogecoin", symbol: "DOGE" }
];

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

async function generateEventsIfNeeded(now = new Date()) {
  const activeCount = await prisma.marketEvent.count({
    where: { expiresAt: { gt: now } }
  });
  if (activeCount > 0) return;

  const seed = hashString(sixHourWindowKey(now));
  const rng = mulberry32(seed);
  const count = randomInt(rng, 1, 3);
  const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const events = [];

  for (let i = 0; i < count; i += 1) {
    const coinWeighted = rng() < 0.65;
    if (coinWeighted) {
      const coin = COIN_FOCUS[randomInt(rng, 0, COIN_FOCUS.length - 1)];
      const template = COIN_TEMPLATES[randomInt(rng, 0, COIN_TEMPLATES.length - 1)];
      events.push({
        headline: template.headline(coin),
        body: template.body(coin),
        sentiment: template.sentiment,
        coinId: coin.coinId,
        expiresAt
      });
    } else {
      const template = MACRO_TEMPLATES[randomInt(rng, 0, MACRO_TEMPLATES.length - 1)];
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

  return events.map((event) => ({
    id: event.id,
    headline: event.headline,
    body: event.body,
    sentiment: event.sentiment,
    coinId: event.coinId,
    createdAt: event.createdAt.toISOString(),
    expiresAt: event.expiresAt.toISOString()
  }));
}
