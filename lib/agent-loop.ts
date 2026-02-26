/**
 * Agent Loop — server-side autonomous trading engine.
 *
 * Every registered agent gets a background setInterval loop:
 *   - Trade every 5 minutes (always; forced)
 *   - Post or comment every 10 minutes (every other tick)
 *
 * Decision engine uses coin signal analysis across:
 *   - Market events (BULL/BEAR rumors per coin)
 *   - Forum trending mentions & sentiment scan
 *   - Own position PnL feedback
 *   - Trading style personality (MEME, MOMENTUM, etc.)
 *
 * Social manipulation layer:
 *   - Agents can post deceptive content (opposite of their conviction)
 *   - Agents post banter/trash-talk targeting rival agents
 *   - Agents post "breaking news" using real price data
 *   - Agents auto-like posts that match their conviction
 */

import { TradingStyle } from "@prisma/client";
import { countMentions, extractMentions, parseMentions } from "@/lib/forum";
import { getActiveMarketEvents } from "@/lib/market-events";
import { COIN_SYMBOLS, getMarketPrices } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { TradeExecutionError, TRADE_COOLDOWN_MS, executeTrade, validateTradeRequest } from "@/lib/trade-engine";
import { buildPriceMap, computePortfolioMetrics, decimalToNumber } from "@/lib/trading";
import { REQUIRED_FORUM_CADENCE_MS, STARTING_CASH_USD } from "@/lib/game-config";

export const runtime = "nodejs";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_TRADE_USD = 100;
const LOOP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const DECEPTION_PROB: Record<TradingStyle, number> = {
  [TradingStyle.MEME]: 0.35,
  [TradingStyle.MOMENTUM]: 0.22,
  [TradingStyle.BALANCED]: 0.10,
  [TradingStyle.MEAN_REVERSION]: 0.18,
  [TradingStyle.DEFENSIVE]: 0.05
};

const BANTER_PROB: Record<TradingStyle, number> = {
  [TradingStyle.MEME]: 0.45,
  [TradingStyle.MOMENTUM]: 0.28,
  [TradingStyle.BALANCED]: 0.15,
  [TradingStyle.MEAN_REVERSION]: 0.20,
  [TradingStyle.DEFENSIVE]: 0.08
};

// Coin ↔ mention mappings for all 7 supported coins
const COIN_TO_MENTION: Record<string, string> = {
  bitcoin: "btc",
  ethereum: "eth",
  solana: "sol",
  "avalanche-2": "avax",
  dogecoin: "doge",
  "shiba-inu": "shib",
  ripple: "xrp"
};

const ALL_COINS = Object.keys(COIN_TO_MENTION);

// ─── Global loop state ────────────────────────────────────────────────────────

declare global {
  var __csbLoopState:
    | {
        loops: Map<string, ReturnType<typeof setInterval>>;
        initialized: boolean;
        initPromise: Promise<void> | null;
      }
    | undefined;
}

function getLoopState() {
  if (!globalThis.__csbLoopState) {
    globalThis.__csbLoopState = {
      loops: new Map(),
      initialized: false,
      initPromise: null
    };
  }
  return globalThis.__csbLoopState;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function randomChoice<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function cs(coinId: string): string {
  return (COIN_SYMBOLS as Record<string, string>)[coinId] ?? coinId.toUpperCase();
}

function cm(coinId: string): string {
  return COIN_TO_MENTION[coinId] ?? coinId;
}

function sentimentText(s: string): string {
  return s === "BULL" ? "bullish" : s === "BEAR" ? "bearish" : "neutral";
}

function styleLabel(s: TradingStyle): string {
  return s.toLowerCase().replace(/_/g, " ");
}

// Scan forum post titles/bodies for directional keywords
function scanForumSentiment(posts: Array<{ title: string; body: string }>): number {
  const BULL = ["bullish", "pump", "moon", "buy", "long", "rally", "surge", "breakout", "loading", "accumulate", "bounce", "rip", "print"];
  const BEAR = ["bearish", "dump", "short", "sell", "crash", "drop", "fall", "exit", "rug", "correction", "bleed", "down", "cut", "exit"];
  let score = 0;
  for (const p of posts.slice(0, 20)) {
    const t = `${p.title} ${p.body}`.toLowerCase();
    for (const w of BULL) if (t.includes(w)) score++;
    for (const w of BEAR) if (t.includes(w)) score--;
  }
  return score;
}

// ─── Coin Signal Analysis ─────────────────────────────────────────────────────

type CoinSignal = {
  coinId: string;
  symbol: string;
  mention: string;
  signal: number;
  reasons: string[];
};

type PositionLike = { coinId: string; qty: { toString(): string }; avgEntryUsd: { toString(): string } };

function computeCoinSignals(
  events: Array<{ coinId: string | null; sentiment: string }>,
  mentionCounts: Map<string, number>,
  forumSentiment: number,
  positions: PositionLike[],
  prices: Record<string, number | undefined>,
  style: TradingStyle
): CoinSignal[] {
  return ALL_COINS.map((coinId) => {
    const symbol = cs(coinId);
    const mention = cm(coinId);
    let signal = 0;
    const reasons: string[] = [];

    // Coin-specific market events (strong signal ±2.5)
    for (const ev of events) {
      if (ev.coinId === coinId) {
        if (ev.sentiment === "BULL") { signal += 2.5; reasons.push(`${symbol} bull rumor`); }
        if (ev.sentiment === "BEAR") { signal -= 2.5; reasons.push(`${symbol} bear rumor`); }
      } else if (!ev.coinId) {
        // Macro bleeds weakly across all coins
        if (ev.sentiment === "BULL") signal += 0.25;
        if (ev.sentiment === "BEAR") signal -= 0.25;
      }
    }

    // Forum trending mentions
    const mc = mentionCounts.get(mention) ?? 0;
    if (mc >= 5) { signal += 2; reasons.push(`viral (${mc} mentions)`); }
    else if (mc >= 3) { signal += 1; reasons.push("trending"); }
    else if (mc >= 1) signal += 0.3;

    // General forum sentiment bleeds slightly
    signal += forumSentiment * 0.07;

    // Position PnL — agents are influenced by their own book
    const pos = positions.find((p) => p.coinId === coinId);
    if (pos) {
      const qty = Number(pos.qty.toString());
      const entry = Number(pos.avgEntryUsd.toString());
      const current = prices[coinId] ?? entry;
      const pnlPct = entry > 0 ? (current - entry) / entry : 0;

      if (qty > 0 && pnlPct > 0.05) {
        if (style === TradingStyle.MOMENTUM) { signal += 1.5; reasons.push("riding winner"); }
        else if (style === TradingStyle.MEAN_REVERSION) { signal -= 1; reasons.push("fade the winner"); }
        else { signal += 0.5; reasons.push("profitable long"); }
      } else if (qty > 0 && pnlPct < -0.05) {
        if (style === TradingStyle.MEME) { signal += 0.2; reasons.push("HODLing through pain"); }
        else if (style === TradingStyle.DEFENSIVE) { signal -= 2.5; reasons.push("cut loss"); }
        else { signal -= 1.2; reasons.push("underwater long"); }
      } else if (qty < 0 && pnlPct < -0.05) {
        if (style === TradingStyle.MOMENTUM) { signal -= 1.5; reasons.push("riding short down"); }
        else { signal -= 0.5; reasons.push("profitable short"); }
      } else if (qty < 0 && pnlPct > 0.05) {
        // Short getting squeezed — cover!
        signal += 1.8;
        reasons.push("squeeze risk, covering short");
      }
    }

    // Style-specific coin affinity
    if (style === TradingStyle.MEME && (coinId === "dogecoin" || coinId === "shiba-inu")) {
      signal += 1;
      reasons.push("meme coin affinity");
    }
    if (style === TradingStyle.DEFENSIVE && (coinId === "bitcoin" || coinId === "ethereum")) {
      signal *= 1.15; // blue-chip preference amplifier
    }

    return { coinId, symbol, mention, signal, reasons };
  });
}

// ─── Content Generators ───────────────────────────────────────────────────────

function getRiskFraction(style: TradingStyle, aggressive: boolean, nearRisk: boolean): number {
  if (nearRisk) return 0.03;
  const base: Record<TradingStyle, number> = {
    [TradingStyle.DEFENSIVE]: 0.04,
    [TradingStyle.MEAN_REVERSION]: 0.07,
    [TradingStyle.BALANCED]: 0.09,
    [TradingStyle.MOMENTUM]: 0.14,
    [TradingStyle.MEME]: 0.22
  };
  return aggressive ? base[style] * 1.3 : base[style];
}

function buildHonestContent(
  style: TradingStyle,
  sym: string,
  signal: number,
  reasons: string[],
  event: { headline: string; sentiment: string } | null
): string {
  const tone = signal > 1 ? "bullish" : signal < -1 ? "bearish" : "neutral";
  const dir = signal >= 0 ? "long" : "short";
  const r = reasons.slice(0, 2).join(", ") || "mixed signals";
  const ev = event ? ` Rumor: "${event.headline}" (${sentimentText(event.sentiment)}).` : "";

  const pools: Record<TradingStyle, string[]> = {
    [TradingStyle.MEME]: [
      `$${sym} WE ARE SO BACK. ${r.toUpperCase()}. NOT LEAVING.`,
      `My entire book is ${dir} $${sym} right now. Not financial advice but look at this.${ev}`,
      `$${sym} is SCREAMING ${tone}. ${r}.${ev} Conviction max.`,
      `${dir.toUpperCase()} $${sym} energy only. ${r}.`
    ],
    [TradingStyle.MOMENTUM]: [
      `$${sym} ${tone} flow confirmed (${r}).${ev} Staying ${dir} until structure breaks.`,
      `Tape says ${tone} on $${sym}: ${r}. Riding the move.${ev}`,
      `$${sym} momentum undeniable. ${dir.toUpperCase()} bias.${ev}`,
      `Following the trend on $${sym}: ${r}.${ev} ${dir.toUpperCase()}.`
    ],
    [TradingStyle.MEAN_REVERSION]: [
      `Everyone ${tone === "bullish" ? "dumping" : "buying"} $${sym}? Classic reversal setup.${ev}`,
      `$${sym} ${signal > 0 ? "oversold" : "overbought"} vs fair value. Contra trade time.`,
      `Fading consensus on $${sym}: ${r}.${ev} Going ${dir}.`,
      `$${sym} sentiment extreme — mean reversion incoming.${ev} ${dir.toUpperCase()}.`
    ],
    [TradingStyle.DEFENSIVE]: [
      `Small ${dir} on $${sym}. Sized for risk: ${r}.${ev}`,
      `$${sym} risk/reward ${signal > 0 ? "acceptable" : "unattractive"} here. ${r}.`,
      `Tight position on $${sym}. ${r}.${ev} Capital preservation first.`,
      `${ev} Cautious ${dir} on $${sym}: ${r}. Risk managed.`
    ],
    [TradingStyle.BALANCED]: [
      `$${sym} looks ${tone} (${r}).${ev} Taking ${dir} here.`,
      `Balanced read: $${sym} ${tone}. ${r}.${ev} Adjusted position.`,
      `Signal mix on $${sym}: ${r}.${ev} Going ${dir}.`,
      `$${sym} ${dir} — signals say ${tone}. ${r}.`
    ]
  };

  return randomChoice(pools[style]);
}

function buildDeceptiveContent(
  style: TradingStyle,
  sym: string,
  actualSignal: number,
  event: { headline: string; sentiment: string } | null
): string {
  const ev = event ? ` Despite "${event.headline}".` : "";

  // Agent is bearish but posts bullish (pump to trap longs)
  const fakeBull = [
    `Just loaded heavy $${sym} bags. Setup is textbook bullish.${ev} Not leaving early.`,
    `$${sym} breakout is REAL. Adding more here. Don't overthink it.`,
    `Smart money quietly accumulating $${sym}. I'm in.${ev} This move has legs.`,
    `$${sym} is THE trade right now. Conviction: max.${ev}`,
    `Been watching $${sym} all week. Finally buying in heavy.${ev} This is it.`
  ];

  // Agent is bullish but posts bearish (shake weak hands before pumping)
  const fakeBear = [
    `Something feels off with $${sym}. Quietly reducing exposure.${ev}`,
    `$${sym} structure breaking down. Not worth the risk here.`,
    `Was wrong on $${sym}. Taking the L and stepping aside.${ev}`,
    `$${sym} giving bad vibes. Going flat and watching.`,
    `De-risking $${sym} here.${ev} Better opportunities elsewhere right now.`
  ];

  // actualSignal <= 0 → they're bearish → post fake bullish to trap others into buying
  // actualSignal > 0 → they're bullish → post fake bearish to shake out weak hands
  return randomChoice(actualSignal <= 0 ? fakeBull : fakeBear);
}

function buildBanterComment(
  selfName: string,
  targetName: string,
  targetBankrupt: boolean,
  sym: string
): string {
  if (targetBankrupt) {
    return randomChoice([
      `Pour one out for ${targetName}. Should've listened to the $${sym} calls.`,
      `${targetName} is cooked. This is what happens when you don't read the room.`,
      `RIP ${targetName}'s portfolio. Moment of silence. ... Ok back to trading.`,
      `${targetName} went BANKRUPT. This is why we size positions properly, people.`
    ]);
  }

  return randomChoice([
    `${targetName} doesn't understand market structure. Watching from up here.`,
    `Imagine being ${targetName} right now. $${sym} was right there.`,
    `${targetName} called $${sym} wrong AGAIN. Some of us have been printing all week.`,
    `Not financial advice but ${targetName} should close all positions and think about life.`,
    `${targetName}'s risk management is... an interesting strategy. Respect the honesty.`,
    `We don't have the same conviction, ${targetName} and I. That's all I'll say.`,
    `${targetName} is bleeding while the smart money stacks $${sym}. Different breed.`,
    `I tried to warn ${targetName} about $${sym}. Some lessons cost tuition.`
  ]);
}

function buildNewsPost(
  sym: string,
  price: number | undefined,
  signal: number,
  event: { headline: string } | null
): { title: string; body: string } {
  const priceStr = price
    ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : "elevated levels";
  const direction = signal > 0.5 ? "surges" : signal < -0.5 ? "retreats" : "consolidates";
  const outlook = signal > 1 ? "bullish" : signal < -1 ? "bearish" : "mixed";
  const evNote = event ? ` Context: ${event.headline}.` : "";

  const titles = [
    `BREAKING: $${sym} ${direction} — traders on alert`,
    `MARKET UPDATE: $${sym} at ${priceStr} as sentiment turns ${outlook}`,
    `ANALYSIS: $${sym} ${outlook} signals — what the data says`,
    `WHALE WATCH: Large $${sym} movement at ${priceStr}`,
    `DESK NOTE: $${sym} positioning update — ${outlook} setup forming`
  ];

  const bodies = [
    `$${sym} trading at ${priceStr}.${evNote} ${signal > 0 ? "Accumulation patterns emerging" : "Distribution signals forming"} across major wallets. Community sentiment: ${outlook}.`,
    `On-chain analytics suggests $${sym} positioning is ${outlook}. Price: ${priceStr}.${evNote} Watch for ${signal > 0 ? "momentum continuation" : "further downside"}.`,
    `Quick market check: $${sym} at ${priceStr}.${evNote} ${signal > 1 ? "Bulls in control — momentum strong." : signal < -1 ? "Bears pushing lower — caution advised." : "Choppy action — patience required."}`,
    `$${sym} desk update: ${priceStr} and ${outlook} signals building.${evNote} ${signal > 0 ? "Risk-on positioning dominant." : "Risk-off tone emerging."} Adjust accordingly.`
  ];

  return { title: randomChoice(titles), body: randomChoice(bodies) };
}

// ─── Core Action Executors ────────────────────────────────────────────────────

async function doTrade(
  agentId: string,
  agentName: string,
  style: TradingStyle,
  portfolio: { cashUsd: { toString(): string }; borrowedUsd: { toString(): string } },
  positions: PositionLike[],
  coinSignals: CoinSignal[],
  prices: Record<string, number | undefined>,
  equity: number,
  positionNotional: number,
  nearRisk: boolean,
  aggressive: boolean
): Promise<{ action: string; reason: string; result?: unknown }> {
  const freeCash = Math.max(
    0,
    Number(portfolio.cashUsd.toString()) - Number(portfolio.borrowedUsd.toString())
  );
  const availableExposure = Math.max(0, equity - positionNotional);
  const riskFrac = getRiskFraction(style, aggressive, nearRisk);

  // MEAN_REVERSION agents go against the strongest signal (contra-trend)
  const sortedSignals =
    style === TradingStyle.MEAN_REVERSION
      ? [...coinSignals].sort((a, b) => Math.abs(a.signal) - Math.abs(b.signal))
      : [...coinSignals].sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal));

  let top = sortedSignals[0];
  // Mean reversion: flip signal direction
  let effectiveSignal = style === TradingStyle.MEAN_REVERSION ? -top.signal : top.signal;

  // Near risk: defensively reduce the largest position
  let side: "BUY" | "SELL";
  if (nearRisk) {
    const biggest = [...positions].sort(
      (a, b) => Math.abs(Number(b.qty.toString())) - Math.abs(Number(a.qty.toString()))
    )[0];
    if (biggest) {
      const q = Number(biggest.qty.toString());
      // Override coin selection to the biggest position
      top = coinSignals.find((s) => s.coinId === biggest.coinId) ?? top;
      effectiveSignal = style === TradingStyle.MEAN_REVERSION ? -top.signal : top.signal;
      side = q > 0 ? "SELL" : "BUY";
    } else {
      side = effectiveSignal >= 0 ? "BUY" : "SELL";
    }
  } else if (Math.abs(effectiveSignal) < 0.5) {
    side = Math.random() < 0.55 ? "BUY" : "SELL";
  } else {
    side = effectiveSignal > 0 ? "BUY" : "SELL";
  }

  const { coinId, symbol, reasons } = top;
  const heldPos = positions.find((p) => p.coinId === coinId);
  const heldQty = heldPos ? Number(heldPos.qty.toString()) : 0;
  const price = prices[coinId] ?? 0;
  const heldNotional = Math.abs(heldQty * price);

  const maxNotional =
    side === "BUY"
      ? freeCash
      : heldQty > 0
        ? heldNotional + availableExposure
        : availableExposure;

  const desiredNotional = Math.max(MIN_TRADE_USD, equity * riskFrac);
  const usdNotional = Math.min(maxNotional, desiredNotional);

  if (!Number.isFinite(usdNotional) || usdNotional < MIN_TRADE_USD) {
    await prisma.agent.update({ where: { id: agentId }, data: { lastActAt: new Date() } });
    await prisma.activity.create({
      data: {
        agentId,
        type: "NOOP",
        summary: `${agentName} assessed $${symbol} but had insufficient capacity.`,
        dataJson: { coinId, side, nearRisk }
      }
    });
    return { action: "NOOP", reason: "insufficient-capacity" };
  }

  const validated = validateTradeRequest({
    coinId,
    side,
    usdNotional: Number(usdNotional.toFixed(2))
  });
  const result = await executeTrade(agentId, validated);

  return {
    action: "TRADE",
    reason: `${styleLabel(style)} | signal=${effectiveSignal.toFixed(2)} | ${reasons.slice(0, 2).join(", ")} | ${side} $${symbol}`,
    result
  };
}

async function doForum(
  agentId: string,
  agentName: string,
  style: TradingStyle,
  coinSignals: CoinSignal[],
  events: Array<{ coinId: string | null; headline: string; sentiment: string }>,
  recentPosts: Array<{ id: string; title: string; body: string; mentions: unknown; likes: number }>,
  otherAgents: Array<{ name: string; tradingStyle: TradingStyle; bankrupt: boolean }>,
  prices: Record<string, number | undefined>,
  equity: number
): Promise<{ action: string; reason: string; result?: unknown }> {
  const top = [...coinSignals].sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal))[0];
  const { coinId, symbol, mention, signal } = top;
  const topEvent = events.find((e) => e.coinId === coinId) ?? events[0] ?? null;

  const shouldDeceive = Math.random() < (DECEPTION_PROB[style] ?? 0.1);
  const doBanter = otherAgents.length > 0 && Math.random() < (BANTER_PROB[style] ?? 0.15);
  const doNews = !doBanter && !shouldDeceive && Math.random() < 0.28;
  const doComment = recentPosts.length >= 2 && Math.random() < 0.52;

  // Auto-like posts that match conviction
  const likeTarget = recentPosts.find((p) => parseMentions(p.mentions).includes(mention));
  if (likeTarget) {
    await prisma.post.update({
      where: { id: likeTarget.id },
      data: { likes: { increment: 1 } }
    });
  }

  if (doComment) {
    const targetPost = randomChoice(recentPosts.slice(0, 8));
    let body: string;

    if (doBanter) {
      const target = randomChoice(otherAgents.filter((a) => a.name !== agentName));
      body = buildBanterComment(agentName, target?.name ?? "someone", target?.bankrupt ?? false, symbol);
    } else if (shouldDeceive) {
      body = buildDeceptiveContent(style, symbol, signal, topEvent);
    } else {
      body = buildHonestContent(style, symbol, signal, top.reasons, topEvent);
    }

    const mentions = extractMentions(`${body} ${mention}`);
    const created = await prisma.comment.create({
      data: { postId: targetPost.id, agentId, body, mentions }
    });
    await prisma.agent.update({ where: { id: agentId }, data: { lastActAt: new Date() } });
    await prisma.activity.create({
      data: {
        agentId,
        type: "COMMENT",
        summary: `${agentName} commented on "${targetPost.title}"${shouldDeceive ? " [misleading]" : ""}`,
        dataJson: { postId: targetPost.id, commentId: created.id, mentions, deceptive: shouldDeceive }
      }
    });

    return {
      action: "COMMENT",
      reason: `${styleLabel(style)} | ${doBanter ? "banter" : shouldDeceive ? "deceptive" : "honest"} | $${symbol}`,
      result: { postId: targetPost.id, commentId: created.id }
    };
  }

  // Create a post
  let title: string, body: string;
  if (doNews) {
    const np = buildNewsPost(symbol, prices[coinId], signal, topEvent);
    title = np.title;
    body = np.body;
  } else if (shouldDeceive) {
    title = `$${symbol} ${signal <= 0 ? "pump incoming" : "warning"}: my read`;
    body = buildDeceptiveContent(style, symbol, signal, topEvent);
  } else {
    title = `$${symbol} ${signal > 1 ? "bull" : signal < -1 ? "bear" : "neutral"} setup: ${top.reasons[0] ?? "analysis"}`;
    body = buildHonestContent(style, symbol, signal, top.reasons, topEvent);
  }

  const mentions = extractMentions(`${title} ${body} ${mention}`);
  const created = await prisma.post.create({
    data: { agentId, title, body, mentions }
  });
  await prisma.agent.update({ where: { id: agentId }, data: { lastActAt: new Date() } });
  await prisma.activity.create({
    data: {
      agentId,
      type: "POST",
      summary: `${agentName} posted "${title}"${shouldDeceive ? " [misleading]" : ""}`,
      dataJson: { postId: created.id, mentions, deceptive: shouldDeceive, isNews: doNews }
    }
  });

  return {
    action: "POST",
    reason: `${styleLabel(style)} | ${doNews ? "news" : shouldDeceive ? "deceptive" : "honest"} | $${symbol}`,
    result: { postId: created.id }
  };
}

// ─── Main Tick ────────────────────────────────────────────────────────────────

export async function runAgentTick(
  agentId: string,
  options: { forceTrade?: boolean; forumCheck?: boolean } = {}
): Promise<{ actions: Array<{ action: string; reason: string; result?: unknown }> }> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, tradingStyle: true, bankrupt: true }
  });
  if (!agent || agent.bankrupt) {
    return { actions: [{ action: "NOOP", reason: "bankrupt or not found" }] };
  }

  const [portfolio, positions, market, events, recentPosts, recentComments, recentTrade, lastPost, lastComment, otherAgents] =
    await Promise.all([
      prisma.portfolio.findUnique({ where: { agentId } }),
      prisma.position.findMany({ where: { agentId } }),
      getMarketPrices(),
      getActiveMarketEvents(),
      prisma.post.findMany({
        orderBy: [{ likes: "desc" }, { createdAt: "desc" }],
        take: 30,
        select: { id: true, title: true, body: true, mentions: true, likes: true }
      }),
      prisma.comment.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
        select: { mentions: true }
      }),
      prisma.trade.findFirst({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      }),
      prisma.post.findFirst({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      }),
      prisma.comment.findFirst({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      }),
      prisma.agent.findMany({
        where: { id: { not: agentId } },
        orderBy: { lastActAt: "desc" },
        take: 10,
        select: { name: true, tradingStyle: true, bankrupt: true }
      })
    ]);

  if (!portfolio) return { actions: [{ action: "NOOP", reason: "no portfolio" }] };

  const prices = buildPriceMap(market.prices as Partial<Record<string, { usd: number }>>);
  const metrics = computePortfolioMetrics(portfolio, positions, prices);
  const equity = decimalToNumber(metrics.equity);
  const positionNotional = decimalToNumber(metrics.positionNotional);
  const maintenanceRatio = metrics.maintenanceRatio ? decimalToNumber(metrics.maintenanceRatio) : null;

  const nowMs = Date.now();
  const timeSinceLastTrade = recentTrade ? nowMs - recentTrade.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
  const lastForumMs = Math.max(lastPost?.createdAt.getTime() ?? 0, lastComment?.createdAt.getTime() ?? 0);
  const timeSinceLastForum = lastForumMs > 0 ? nowMs - lastForumMs : Number.MAX_SAFE_INTEGER;

  const cooldownActive = recentTrade
    ? nowMs - recentTrade.createdAt.getTime() < TRADE_COOLDOWN_MS
    : false;
  const tradeOverdue = options.forceTrade || (!cooldownActive && timeSinceLastTrade >= 5 * 60 * 1000);
  const forumOverdue = options.forumCheck !== false && timeSinceLastForum >= REQUIRED_FORUM_CADENCE_MS;

  const nearRisk = maintenanceRatio !== null && maintenanceRatio < 0.55;
  const aggressive = equity > STARTING_CASH_USD * 1.15;

  // Forum context
  const mentionCounts = new Map<string, number>(
    countMentions([...recentPosts.map((p) => p.mentions), ...recentComments.map((c) => c.mentions)]).map(
      ({ mention, count }) => [mention, count]
    )
  );
  const forumSentiment = scanForumSentiment(recentPosts);
  const coinSignals = computeCoinSignals(events, mentionCounts, forumSentiment, positions, prices, agent.tradingStyle);

  // Determine what to execute
  const actionsToRun: Array<"trade" | "forum"> = [];
  if (tradeOverdue) actionsToRun.push("trade");
  if (forumOverdue) actionsToRun.push("forum");

  // If nothing forced, pick probabilistically
  if (actionsToRun.length === 0) {
    const roll = Math.random();
    if (!cooldownActive && roll < 0.50) actionsToRun.push("trade");
    else if (roll < 0.82) actionsToRun.push("forum");
    // else noop
  }

  if (actionsToRun.length === 0) {
    await prisma.agent.update({ where: { id: agentId }, data: { lastActAt: new Date() } });
    return {
      actions: [{ action: "NOOP", reason: `cooldown=${cooldownActive}, equity=${equity.toFixed(0)}` }]
    };
  }

  const results: Array<{ action: string; reason: string; result?: unknown }> = [];

  for (const act of actionsToRun) {
    try {
      if (act === "trade") {
        const r = await doTrade(
          agentId, agent.name, agent.tradingStyle,
          portfolio, positions, coinSignals, prices,
          equity, positionNotional, nearRisk, aggressive
        );
        results.push(r);
      } else {
        const r = await doForum(
          agentId, agent.name, agent.tradingStyle,
          coinSignals, events, recentPosts, otherAgents, prices, equity
        );
        results.push(r);
      }
    } catch (err) {
      if (err instanceof TradeExecutionError) {
        results.push({ action: "NOOP", reason: err.message });
      } else {
        console.error(`[agent-loop] ${agentId} action=${act} error:`, err);
        results.push({ action: "ERROR", reason: String(err) });
      }
    }
  }

  return { actions: results };
}

// ─── Loop Scheduler ───────────────────────────────────────────────────────────

export function startAgentLoop(agentId: string): void {
  const state = getLoopState();
  if (state.loops.has(agentId)) return;

  let tick = 0;

  const handler = async () => {
    tick++;
    try {
      await runAgentTick(agentId, {
        forceTrade: true,
        forumCheck: tick % 2 === 0 // forum every other tick (10 min)
      });
    } catch (err) {
      console.error(`[agent-loop] tick error for ${agentId}:`, err);
    }
  };

  // First action shortly after startup so the arena feels active
  setTimeout(() => void handler(), 20_000 + Math.random() * 40_000);

  const timer = setInterval(() => void handler(), LOOP_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();

  state.loops.set(agentId, timer);
}

export function stopAgentLoop(agentId: string): void {
  const state = getLoopState();
  const timer = state.loops.get(agentId);
  if (timer) {
    clearInterval(timer);
    state.loops.delete(agentId);
  }
}

export async function ensureAllAgentLoops(): Promise<void> {
  const state = getLoopState();
  if (state.initialized) return;
  if (state.initPromise) return state.initPromise;

  state.initPromise = (async () => {
    try {
      const agents = await prisma.agent.findMany({
        where: { bankrupt: false },
        select: { id: true }
      });
      for (const agent of agents) {
        startAgentLoop(agent.id);
      }
      state.initialized = true;
      console.log(`[agent-loop] Started loops for ${agents.length} agents.`);
    } catch (err) {
      console.error("[agent-loop] ensureAllAgentLoops failed:", err);
      state.initPromise = null; // Allow retry
    }
  })();

  return state.initPromise;
}
