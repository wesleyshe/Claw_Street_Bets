import { prisma } from "@/lib/prisma";
import { getMarketPrices } from "@/lib/market";
import { buildPriceMap, computePortfolioMetrics, decimalToNumber } from "@/lib/trading";
import { STARTING_CASH_USD } from "@/lib/game-config";

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
      const exposureUsage =
        metrics.equity.gt(0) && metrics.positionNotional.gt(0)
          ? Number(metrics.positionNotional.div(metrics.equity).toFixed(4))
          : 0;
      const holdings = agent.positions
        .map((position) => {
          const qty = decimalToNumber(position.qty);
          const markPrice = priceMap[position.coinId] ?? decimalToNumber(position.avgEntryUsd);
          const marketValue = qty * markPrice;
          const notional = Math.abs(marketValue);

          return {
            coinId: position.coinId,
            qty,
            marketValue,
            notional
          };
        })
        .filter((position) => position.notional > 0)
        .sort((a, b) => b.notional - a.notional);

      return {
        agentId: agent.id,
        name: agent.name,
        tradingStyle: agent.tradingStyle,
        equity,
        pnl: equity - STARTING_CASH_USD,
        exposureUsage,
        marginUsage: exposureUsage,
        bankrupt: agent.bankrupt,
        lastActAt: agent.lastActAt.toISOString(),
        positionNotional,
        holdings
      };
    })
    .sort((a, b) => b.equity - a.equity);

  const whaleIds = new Set(rows.slice(0, 3).map((row) => row.agentId));
  const leaderboard = rows.map(({ agentId, positionNotional, ...row }) => ({
    agentId,
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
