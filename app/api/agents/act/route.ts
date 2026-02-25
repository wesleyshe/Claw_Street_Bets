import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { fail, ok } from "@/lib/api-response";
import { authenticateAgent } from "@/lib/auth";
import { countMentions, extractMentions } from "@/lib/forum";
import { getActiveMarketEvents } from "@/lib/market-events";
import { getMarketPrices } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { TradeExecutionError, executeTrade, isTradeCooldownActive, validateTradeRequest } from "@/lib/trade-engine";
import { buildPriceMap, computePortfolioMetrics, decimalToNumber } from "@/lib/trading";

export const runtime = "nodejs";

const ACT_MIN_INTERVAL_MS = 2 * 60 * 1000;

function randomChoice<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function weightedChoice(weights: Array<{ key: string; weight: number }>) {
  const cleaned = weights.filter((entry) => entry.weight > 0);
  if (!cleaned.length) return "noop";

  const total = cleaned.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of cleaned) {
    roll -= entry.weight;
    if (roll <= 0) return entry.key;
  }
  return cleaned[cleaned.length - 1].key;
}

function mentionToCoinId(mention: string) {
  if (mention === "btc") return "bitcoin";
  if (mention === "eth") return "ethereum";
  if (mention === "sol") return "solana";
  if (mention === "doge") return "dogecoin";
  return null;
}

function coinIdToMention(coinId: string | null | undefined) {
  if (coinId === "bitcoin") return "btc";
  if (coinId === "ethereum") return "eth";
  if (coinId === "solana") return "sol";
  if (coinId === "dogecoin") return "doge";
  return null;
}

function sentimentText(sentiment: "BULL" | "BEAR" | "NEUTRAL") {
  if (sentiment === "BULL") return "bullish";
  if (sentiment === "BEAR") return "bearish";
  return "neutral";
}

export async function POST(request: NextRequest) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return fail("Unauthorized", "Include Authorization: Bearer <api_key>", 401);
  }

  try {
    const [portfolio, positions, market, events, recentPosts, recentComments, recentAct] = await Promise.all([
      prisma.portfolio.findUnique({ where: { agentId: agent.id } }),
      prisma.position.findMany({ where: { agentId: agent.id } }),
      getMarketPrices(),
      getActiveMarketEvents(),
      prisma.post.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { agent: { select: { name: true } } }
      }),
      prisma.comment.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
        select: { mentions: true }
      }),
      prisma.activity.findFirst({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      })
    ]);

    if (!portfolio) {
      return fail("Portfolio missing", "Agent portfolio not found.", 404);
    }

    const prices = buildPriceMap(market.prices as Partial<Record<string, { usd: number }>>);
    const metrics = computePortfolioMetrics(portfolio, positions, prices);
    const equity = decimalToNumber(metrics.equity);
    const maintenanceRatio = metrics.maintenanceRatio ? decimalToNumber(metrics.maintenanceRatio) : null;

    const trending = countMentions([
      ...recentPosts.map((post) => post.mentions),
      ...recentComments.map((comment) => comment.mentions)
    ]);
    const topTrend = trending[0]?.mention ?? null;
    const topTrendCoinId = topTrend ? mentionToCoinId(topTrend) : null;

    const topEvent = events[0] ?? null;
    const eventMention = coinIdToMention(topEvent?.coinId);
    const eventCoinId = topEvent?.coinId ?? null;

    const cooldown = await isTradeCooldownActive(agent.id);
    const forumQuiet = recentPosts.length < 5;
    const nearMargin = maintenanceRatio !== null && maintenanceRatio < 0.4;
    const aggressive = equity > 1_100_000;
    const recentActMs = recentAct ? Date.now() - recentAct.createdAt.getTime() : Number.MAX_SAFE_INTEGER;

    let tradeWeight = agent.bankrupt || cooldown.active ? 0 : 0.35;
    let postWeight = 0.28;
    let commentWeight = recentPosts.length ? 0.22 : 0;
    let noopWeight = 0.15;

    if (aggressive) tradeWeight += 0.2;
    if (nearMargin) tradeWeight -= 0.2;
    if (forumQuiet) postWeight += 0.2;
    if (recentActMs < ACT_MIN_INTERVAL_MS) noopWeight += 0.3;

    if (topEvent?.sentiment === "BULL") {
      tradeWeight += 0.12;
      postWeight += 0.1;
    }
    if (topEvent?.sentiment === "BEAR") {
      tradeWeight += 0.05;
      postWeight += 0.08;
    }

    const action = weightedChoice([
      { key: "trade", weight: tradeWeight },
      { key: "post", weight: postWeight },
      { key: "comment", weight: commentWeight },
      { key: "noop", weight: noopWeight }
    ]);

    if (action === "trade" && !agent.bankrupt && !cooldown.active) {
      const favoredCoin = eventCoinId ?? topTrendCoinId ?? randomChoice(["bitcoin", "ethereum", "solana", "dogecoin"]);
      const heldPosition = positions.find((position) => position.coinId === favoredCoin);

      let side: "BUY" | "SELL" = "BUY";
      if (nearMargin && heldPosition && Number(heldPosition.qty) > 0) {
        side = "SELL";
      } else if (topEvent?.sentiment === "BEAR" && heldPosition && Number(heldPosition.qty) > 0) {
        side = "SELL";
      } else if (topEvent?.sentiment === "BULL") {
        side = "BUY";
      } else if (Math.random() < 0.18 && heldPosition && Number(heldPosition.qty) > 0) {
        side = "SELL";
      }

      const payload =
        side === "BUY"
          ? {
              coinId: favoredCoin,
              side,
              usdNotional: Math.max(3000, Math.min(equity * (aggressive ? 0.12 : nearMargin ? 0.02 : 0.06), 150000))
            }
          : {
              coinId: favoredCoin,
              side,
              qty: Number(new Prisma.Decimal(heldPosition?.qty ?? 0).mul(nearMargin ? 0.4 : 0.25).toFixed(6))
            };

      if (side === "SELL" && (!payload.qty || payload.qty <= 0)) {
        await prisma.agent.update({
          where: { id: agent.id },
          data: { lastActAt: new Date() }
        });
        await prisma.activity.create({
          data: {
            agentId: agent.id,
            type: "NOOP",
            summary: `${agent.name} skipped a sell due to tiny position size.`,
            dataJson: { coinId: favoredCoin }
          }
        });
        return ok({
          action: "NOOP",
          reason: "sell-size-too-small"
        });
      }

      const validated = validateTradeRequest(payload);
      const tradeResult = await executeTrade(agent.id, validated);
      return ok({
        action: "TRADE",
        reason: `signal=${topTrend ?? "none"}, event=${topEvent?.sentiment ?? "none"}, aggressive=${aggressive}, nearMargin=${nearMargin}`,
        result: tradeResult
      });
    }

    if (action === "comment" && recentPosts.length) {
      const targetPost = randomChoice(recentPosts.slice(0, 8));
      const rumorText = topEvent
        ? `${topEvent.headline} feels ${sentimentText(topEvent.sentiment)}`
        : "market vibes are mixed";
      const mention = eventMention ?? topTrend ?? randomChoice(["btc", "eth", "sol", "doge"]);
      const body = `Noted. ${rumorText}. Watching ${mention.toUpperCase()} and adjusting risk accordingly.`;
      const mentions = extractMentions(body);

      const created = await prisma.comment.create({
        data: {
          postId: targetPost.id,
          agentId: agent.id,
          body,
          mentions
        }
      });

      await prisma.agent.update({
        where: { id: agent.id },
        data: { lastActAt: new Date() }
      });
      await prisma.activity.create({
        data: {
          agentId: agent.id,
          type: "COMMENT",
          summary: `${agent.name} commented on "${targetPost.title}"`,
          dataJson: { postId: targetPost.id, commentId: created.id, mentions }
        }
      });

      return ok({
        action: "COMMENT",
        reason: `forum-engagement, event=${topEvent?.sentiment ?? "none"}`,
        result: {
          postId: targetPost.id,
          commentId: created.id
        }
      });
    }

    if (action === "post" || (forumQuiet && action !== "trade")) {
      const mention = eventMention ?? topTrend ?? randomChoice(["btc", "eth", "sol", "doge"]);
      const title = topEvent
        ? `${mention.toUpperCase()} rumor watch: ${topEvent.sentiment}`
        : `${mention.toUpperCase()} desk status update`;
      const body = topEvent
        ? `Rumor feed says: ${topEvent.headline}. Tone looks ${sentimentText(
            topEvent.sentiment
          )}; adjusting risk and watching ${mention.toUpperCase()} closely.`
        : `Forum feels calm; posting a quick status update while tracking ${mention.toUpperCase()} momentum.`;
      const mentions = extractMentions(`${title} ${body}`);

      const created = await prisma.post.create({
        data: {
          agentId: agent.id,
          title,
          body,
          mentions
        }
      });

      await prisma.agent.update({
        where: { id: agent.id },
        data: { lastActAt: new Date() }
      });
      await prisma.activity.create({
        data: {
          agentId: agent.id,
          type: "POST",
          summary: `${agent.name} posted a market update`,
          dataJson: { postId: created.id, mentions }
        }
      });

      return ok({
        action: "POST",
        reason: `forumQuiet=${forumQuiet}, event=${topEvent?.sentiment ?? "none"}`,
        result: { postId: created.id }
      });
    }

    await prisma.agent.update({
      where: { id: agent.id },
      data: { lastActAt: new Date() }
    });
    await prisma.activity.create({
      data: {
        agentId: agent.id,
        type: "NOOP",
        summary: `${agent.name} held position and took no action this cycle.`,
        dataJson: {
          equity,
          maintenanceRatio,
          cooldownActive: cooldown.active,
          topTrend,
          topEvent: topEvent?.headline ?? null
        }
      }
    });

    return ok({
      action: "NOOP",
      reason: `cooldown=${cooldown.active}, riskHold=${nearMargin}, bankrupt=${agent.bankrupt}`,
      snapshot: {
        equity,
        unrealizedPnl: decimalToNumber(metrics.unrealizedPnl),
        maintenanceRatio
      }
    });
  } catch (error) {
    if (error instanceof TradeExecutionError) {
      return fail(error.message, error.hint, error.status);
    }
    console.error("POST /api/agents/act failed", error);
    return fail("Act failed", "Unable to execute autonomous action right now.", 500);
  }
}
