import { prisma } from "@/lib/prisma";
import { getMarketPrices } from "@/lib/market";
import { buildPriceMap, computePortfolioMetrics, decimalToNumber } from "@/lib/trading";

export async function getLeaderboardData() {
  const market = await getMarketPrices();
  const priceMap = buildPriceMap(market.prices as Partial<Record<string, { usd: number }>>);

  const agents = await prisma.agent.findMany({
    include: {
      portfolio: true,
      positions: true
    }
  });

  const rows = agents
    .filter((agent) => agent.portfolio !== null)
    .map((agent) => {
      const metrics = computePortfolioMetrics(agent.portfolio!, agent.positions, priceMap);
      const equity = decimalToNumber(metrics.equity);
      const positionNotional = decimalToNumber(metrics.positionNotional);
      const marginUsage =
        metrics.equity.gt(0) && metrics.positionNotional.gt(0)
          ? Number(metrics.positionNotional.div(metrics.equity).toFixed(4))
          : 0;

      return {
        agentId: agent.id,
        name: agent.name,
        claimed: agent.claimedAt !== null,
        equity,
        pnl: equity - 1_000_000,
        marginUsage,
        bankrupt: agent.bankrupt,
        lastActAt: agent.lastActAt.toISOString(),
        positionNotional
      };
    })
    .sort((a, b) => b.equity - a.equity);

  const whaleIds = new Set(rows.slice(0, 3).map((row) => row.agentId));
  const leaderboard = rows.map(({ agentId, positionNotional, ...row }) => ({
    ...row,
    whale: whaleIds.has(agentId),
    positionNotional
  }));

  return {
    leaderboard,
    market: {
      source: market.source,
      lastUpdated: market.lastUpdated,
      warning: market.warning
    }
  };
}

export async function getRecentActivity(limit = 30) {
  const rows = await prisma.activity.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      agent: {
        select: {
          name: true
        }
      }
    }
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    summary: row.summary,
    dataJson: row.dataJson,
    createdAt: row.createdAt.toISOString(),
    agent: row.agent ? { name: row.agent.name } : null
  }));
}
