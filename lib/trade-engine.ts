import { Prisma, TradeSide } from "@prisma/client";
import { getMarketPrices, SUPPORTED_COINS } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { buildPriceMap, computePortfolioMetrics, decimalToNumber, getCoinPriceOrThrow } from "@/lib/trading";

export const TRADE_COOLDOWN_MS = 60_000;
const MAX_GROSS_EXPOSURE = new Prisma.Decimal(1);
const MAINTENANCE_MARGIN = new Prisma.Decimal(0.25);

export type TradeRequest = {
  coinId?: string;
  side?: "BUY" | "SELL";
  usdNotional?: number;
  qty?: number;
};

export class TradeExecutionError extends Error {
  status: number;
  hint: string;

  constructor(message: string, hint: string, status = 400) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

type MutablePosition = {
  id: string;
  agentId: string;
  coinId: string;
  qty: Prisma.Decimal;
  avgEntryUsd: Prisma.Decimal;
};

function sweepBorrowedBalance(cashUsd: Prisma.Decimal, borrowedUsd: Prisma.Decimal) {
  if (cashUsd.lte(0) || borrowedUsd.lte(0)) {
    return { cashUsd, borrowedUsd };
  }
  const repay = Prisma.Decimal.min(cashUsd, borrowedUsd);
  return {
    cashUsd: cashUsd.minus(repay),
    borrowedUsd: borrowedUsd.minus(repay)
  };
}

export function validateTradeRequest(body: TradeRequest): {
  coinId: string;
  side: "BUY" | "SELL";
  usdNotional: Prisma.Decimal | null;
  qty: Prisma.Decimal | null;
} {
  const coinId = body.coinId?.trim();
  const side = body.side;
  const hasUsdNotional = typeof body.usdNotional === "number";
  const hasQty = typeof body.qty === "number";

  if (!coinId || !SUPPORTED_COINS.includes(coinId as (typeof SUPPORTED_COINS)[number])) {
    throw new TradeExecutionError("Unsupported coinId", "Use one of the supported CoinGecko IDs.");
  }
  if (side !== "BUY" && side !== "SELL") {
    throw new TradeExecutionError("Invalid side", 'side must be "BUY" or "SELL".');
  }
  if (hasUsdNotional === hasQty) {
    throw new TradeExecutionError("Invalid order size", "Provide exactly one of usdNotional or qty.");
  }
  if (hasUsdNotional && (body.usdNotional as number) <= 0) {
    throw new TradeExecutionError("Invalid usdNotional", "usdNotional must be greater than 0.");
  }
  if (hasQty && (body.qty as number) <= 0) {
    throw new TradeExecutionError("Invalid qty", "qty must be greater than 0.");
  }

  return {
    coinId,
    side,
    usdNotional: hasUsdNotional ? new Prisma.Decimal(body.usdNotional as number) : null,
    qty: hasQty ? new Prisma.Decimal(body.qty as number) : null
  };
}

export async function isTradeCooldownActive(agentId: string, at = new Date()) {
  const latestTrade = await prisma.trade.findFirst({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true }
  });

  if (!latestTrade) return { active: false as const, waitSeconds: 0 };
  const elapsedMs = at.getTime() - latestTrade.createdAt.getTime();
  if (elapsedMs >= TRADE_COOLDOWN_MS) return { active: false as const, waitSeconds: 0 };
  return {
    active: true as const,
    waitSeconds: Math.ceil((TRADE_COOLDOWN_MS - elapsedMs) / 1000)
  };
}

export async function executeTrade(agentId: string, input: ReturnType<typeof validateTradeRequest>) {
  const market = await getMarketPrices().catch(() => null);
  if (!market) {
    throw new TradeExecutionError(
      "Market unavailable",
      "Cannot execute trades without live market price.",
      500
    );
  }

  const priceMap = buildPriceMap(market.prices as Partial<Record<string, { usd: number }>>);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({
      where: { id: agentId }
    });
    if (!agent) {
      throw new TradeExecutionError("Agent not found", "Register again if this persists.", 404);
    }
    if (agent.bankrupt) {
      throw new TradeExecutionError("Forbidden", "Bankrupt agents cannot place trades.", 403);
    }

    const latestTrade = await tx.trade.findFirst({
      where: { agentId: agent.id },
      orderBy: { createdAt: "desc" }
    });

    if (latestTrade) {
      const elapsedMs = now.getTime() - latestTrade.createdAt.getTime();
      if (elapsedMs < TRADE_COOLDOWN_MS) {
        const waitSec = Math.ceil((TRADE_COOLDOWN_MS - elapsedMs) / 1000);
        throw new TradeExecutionError("Trade cooldown", `Wait ${waitSec}s before placing another trade.`, 403);
      }
    }

    const portfolio = await tx.portfolio.findUnique({ where: { agentId: agent.id } });
    if (!portfolio) {
      throw new TradeExecutionError("Portfolio missing", "Agent portfolio not found.", 404);
    }

    const positions = await tx.position.findMany({ where: { agentId: agent.id } });
    const byCoin = new Map<string, MutablePosition>(
      positions.map((position) => [
        position.coinId,
        {
          id: position.id,
          agentId: position.agentId,
          coinId: position.coinId,
          qty: new Prisma.Decimal(position.qty),
          avgEntryUsd: new Prisma.Decimal(position.avgEntryUsd)
        }
      ])
    );
    const priceUsd = getCoinPriceOrThrow(input.coinId, priceMap);
    const orderQty = input.qty ?? (input.usdNotional as Prisma.Decimal).div(priceUsd);
    const notionalUsd = orderQty.mul(priceUsd);

    if (!orderQty.gt(0)) {
      throw new TradeExecutionError("Invalid size", "Order quantity must be greater than zero.");
    }

    let cashUsd = new Prisma.Decimal(portfolio.cashUsd);
    let borrowedUsd = new Prisma.Decimal(portfolio.borrowedUsd);
    ({ cashUsd, borrowedUsd } = sweepBorrowedBalance(cashUsd, borrowedUsd));
    const currentPositions = Array.from(byCoin.values()).map((position) => ({
      coinId: position.coinId,
      qty: position.qty,
      avgEntryUsd: position.avgEntryUsd
    }));
    const currentMetrics = computePortfolioMetrics({ cashUsd, borrowedUsd }, currentPositions, priceMap);
    const existing = byCoin.get(input.coinId);
    const existingQty = existing?.qty ?? new Prisma.Decimal(0);
    const existingAbsQty = existingQty.abs();

    if (input.side === TradeSide.BUY) {
      if (cashUsd.lt(notionalUsd)) {
        throw new TradeExecutionError(
          "Insufficient cash",
          "No margin is allowed. Reduce order size or close shorts first.",
          403
        );
      }
      cashUsd = cashUsd.minus(notionalUsd);

      const nextQty = existingQty.plus(orderQty);
      if (nextQty.eq(0)) {
        byCoin.delete(input.coinId);
      } else {
        let nextAvgEntry = priceUsd;
        if (existingQty.gt(0) && existing) {
          nextAvgEntry = existing.avgEntryUsd
            .mul(existingAbsQty)
            .plus(priceUsd.mul(orderQty))
            .div(nextQty.abs());
        } else if (existingQty.lt(0) && existing) {
          if (nextQty.lt(0)) {
            nextAvgEntry = existing.avgEntryUsd;
          } else if (nextQty.gt(0)) {
            nextAvgEntry = priceUsd;
          }
        }

        byCoin.set(input.coinId, {
          id: existing?.id ?? "",
          agentId: agent.id,
          coinId: input.coinId,
          qty: nextQty,
          avgEntryUsd: nextAvgEntry
        });
      }
    } else {
      cashUsd = cashUsd.plus(notionalUsd);

      const nextQty = existingQty.minus(orderQty);
      if (nextQty.eq(0)) {
        byCoin.delete(input.coinId);
      } else {
        let nextAvgEntry = priceUsd;

        if (existingQty.lt(0) && existing) {
          nextAvgEntry = existing.avgEntryUsd
            .mul(existingAbsQty)
            .plus(priceUsd.mul(orderQty))
            .div(nextQty.abs());
        } else if (existingQty.gt(0) && existing) {
          if (nextQty.gt(0)) {
            nextAvgEntry = existing.avgEntryUsd;
          } else if (nextQty.lt(0)) {
            nextAvgEntry = priceUsd;
          }
        }

        byCoin.set(input.coinId, {
          id: existing?.id ?? "",
          agentId: agent.id,
          coinId: input.coinId,
          qty: nextQty,
          avgEntryUsd: nextAvgEntry
        });
      }
    }
    ({ cashUsd, borrowedUsd } = sweepBorrowedBalance(cashUsd, borrowedUsd));

    const projectedPositions = Array.from(byCoin.values()).map((position) => ({
      coinId: position.coinId,
      qty: position.qty,
      avgEntryUsd: position.avgEntryUsd
    }));
    const projectedMetrics = computePortfolioMetrics({ cashUsd, borrowedUsd }, projectedPositions, priceMap);

    if (!projectedMetrics.equity.gt(0)) {
      throw new TradeExecutionError(
        "Risk violation",
        "Order would result in non-positive equity.",
        403
      );
    }

    const exceedsExposureCap = projectedMetrics.positionNotional.gt(
      projectedMetrics.equity.mul(MAX_GROSS_EXPOSURE)
    );
    if (exceedsExposureCap && !projectedMetrics.positionNotional.lt(currentMetrics.positionNotional)) {
      throw new TradeExecutionError(
        "Risk violation",
        "No margin is allowed. Gross exposure cannot exceed current equity.",
        403
      );
    }

    const existingTradePosition = positions.find((position) => position.coinId === input.coinId);
    const nextPosition = byCoin.get(input.coinId);

    if (nextPosition && existingTradePosition) {
      await tx.position.update({
        where: { id: existingTradePosition.id },
        data: {
          qty: nextPosition.qty,
          avgEntryUsd: nextPosition.avgEntryUsd
        }
      });
    } else if (nextPosition) {
      await tx.position.create({
        data: {
          agentId: agent.id,
          coinId: input.coinId,
          qty: nextPosition.qty,
          avgEntryUsd: nextPosition.avgEntryUsd
        }
      });
    } else if (existingTradePosition) {
      await tx.position.delete({ where: { id: existingTradePosition.id } });
    }

    await tx.trade.create({
      data: {
        agentId: agent.id,
        coinId: input.coinId,
        side: input.side,
        qty: orderQty,
        priceUsd,
        notionalUsd
      }
    });

    await tx.activity.create({
      data: {
        agentId: agent.id,
        type: "TRADE",
        summary: `${agent.name} ${input.side === "BUY" ? "bought" : "sold"} ${orderQty.toFixed(
          6
        )} ${input.coinId} @ $${priceUsd.toFixed(2)}`,
        dataJson: {
          coinId: input.coinId,
          side: input.side,
          qty: decimalToNumber(orderQty),
          priceUsd: decimalToNumber(priceUsd),
          notionalUsd: decimalToNumber(notionalUsd)
        }
      }
    });

    let finalCashUsd = cashUsd;
    let finalBorrowedUsd = borrowedUsd;
    let finalPositions = projectedPositions;
    let liquidationTriggered = false;
    let bankrupt: boolean = agent.bankrupt;

    if (
      projectedMetrics.positionNotional.gt(0) &&
      projectedMetrics.maintenanceRatio !== null &&
      projectedMetrics.maintenanceRatio.lt(MAINTENANCE_MARGIN)
    ) {
      liquidationTriggered = true;
      let liquidationProceeds = new Prisma.Decimal(0);

      for (const position of finalPositions) {
        const coinPrice = getCoinPriceOrThrow(position.coinId, priceMap);
        liquidationProceeds = liquidationProceeds.plus(new Prisma.Decimal(position.qty).mul(coinPrice));
      }

      finalCashUsd = finalCashUsd.plus(liquidationProceeds);
      await tx.position.deleteMany({ where: { agentId: agent.id } });
      finalPositions = [];

      ({ cashUsd: finalCashUsd, borrowedUsd: finalBorrowedUsd } = sweepBorrowedBalance(
        finalCashUsd,
        finalBorrowedUsd
      ));

      const equityAfterLiquidation = finalCashUsd.minus(finalBorrowedUsd);
      bankrupt = equityAfterLiquidation.lte(0);

      await tx.activity.create({
        data: {
          agentId: agent.id,
          type: "LIQUIDATION",
          summary: `${agent.name} was liquidated due to risk threshold breach.`,
          dataJson: {
            equityAfterLiquidation: decimalToNumber(equityAfterLiquidation),
            riskThreshold: decimalToNumber(MAINTENANCE_MARGIN)
          }
        }
      });
    }

    await tx.portfolio.update({
      where: { agentId: agent.id },
      data: {
        cashUsd: finalCashUsd,
        borrowedUsd: finalBorrowedUsd
      }
    });

    await tx.agent.update({
      where: { id: agent.id },
      data: {
        bankrupt,
        lastActAt: now
      }
    });

    const finalMetrics = computePortfolioMetrics(
      { cashUsd: finalCashUsd, borrowedUsd: finalBorrowedUsd },
      finalPositions,
      priceMap
    );

    return {
      trade: {
        coinId: input.coinId,
        side: input.side,
        qty: decimalToNumber(orderQty),
        priceUsd: decimalToNumber(priceUsd),
        notionalUsd: decimalToNumber(notionalUsd)
      },
      portfolio: {
        cashUsd: decimalToNumber(finalCashUsd),
        borrowedUsd: decimalToNumber(finalBorrowedUsd),
        equity: decimalToNumber(finalMetrics.equity),
        unrealizedPnl: decimalToNumber(finalMetrics.unrealizedPnl),
        positionNotional: decimalToNumber(finalMetrics.positionNotional),
        maintenanceRatio:
          finalMetrics.maintenanceRatio !== null ? decimalToNumber(finalMetrics.maintenanceRatio) : null
      },
      liquidationTriggered,
      bankrupt
    };
  });
}
