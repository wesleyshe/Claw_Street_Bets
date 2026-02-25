import { Prisma } from "@prisma/client";

type DecimalValue = Prisma.Decimal | string | number;

export type PositionInput = {
  coinId: string;
  qty: DecimalValue;
  avgEntryUsd: DecimalValue;
};

export type PortfolioInput = {
  cashUsd: DecimalValue;
  borrowedUsd: DecimalValue;
};

export type PriceMap = Record<string, number | undefined>;

export type PortfolioMetrics = {
  equity: Prisma.Decimal;
  marketValue: Prisma.Decimal;
  positionNotional: Prisma.Decimal;
  unrealizedPnl: Prisma.Decimal;
  maintenanceRatio: Prisma.Decimal | null;
};

const ZERO = new Prisma.Decimal(0);

function d(value: DecimalValue) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function decimalToNumber(value: Prisma.Decimal) {
  return Number(value.toString());
}

export function isSupportedCoinId(coinId: string, supportedCoinIds: readonly string[]) {
  return supportedCoinIds.includes(coinId);
}

export function getCoinPriceOrThrow(coinId: string, prices: PriceMap) {
  const price = prices[coinId];
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Missing or invalid price for ${coinId}`);
  }
  return new Prisma.Decimal(price);
}

export function computePortfolioMetrics(
  portfolio: PortfolioInput,
  positions: PositionInput[],
  prices: PriceMap
): PortfolioMetrics {
  const cashUsd = d(portfolio.cashUsd);
  const borrowedUsd = d(portfolio.borrowedUsd);

  let marketValue = ZERO;
  let positionNotional = ZERO;
  let unrealizedPnl = ZERO;

  for (const position of positions) {
    const qty = d(position.qty);
    const avgEntryUsd = d(position.avgEntryUsd);
    const priceUsd = getCoinPriceOrThrow(position.coinId, prices);
    const notional = qty.abs().mul(priceUsd);

    marketValue = marketValue.plus(qty.mul(priceUsd));
    positionNotional = positionNotional.plus(notional);
    unrealizedPnl = unrealizedPnl.plus(priceUsd.minus(avgEntryUsd).mul(qty));
  }

  const equity = cashUsd.minus(borrowedUsd).plus(marketValue);
  const maintenanceRatio = positionNotional.gt(0) ? equity.div(positionNotional) : null;

  return { equity, marketValue, positionNotional, unrealizedPnl, maintenanceRatio };
}

export function buildPriceMap(prices: Partial<Record<string, { usd: number }>>) {
  const map: PriceMap = {};
  for (const [coinId, quote] of Object.entries(prices)) {
    map[coinId] = quote.usd;
  }
  return map;
}
