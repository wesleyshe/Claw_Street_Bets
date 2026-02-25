import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarketPrices } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { buildPriceMap, computePortfolioMetrics, decimalToNumber } from "@/lib/trading";

export const dynamic = "force-dynamic";

type AgentPageProps = {
  params: {
    id: string;
  };
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 6 : 2
  }).format(value);
}

function formatStyleLabel(style?: string) {
  return (style ?? "BALANCED").replaceAll("_", " ");
}

export default async function AgentHoldingsPage({ params }: AgentPageProps) {
  const [agent, market] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: params.id },
      include: {
        portfolio: true,
        positions: true
      }
    }),
    getMarketPrices().catch(() => null)
  ]);

  if (!agent || !agent.portfolio) {
    notFound();
  }

  const prices = buildPriceMap((market?.prices as Partial<Record<string, { usd: number }>>) ?? {});
  const metrics = (() => {
    try {
      return computePortfolioMetrics(agent.portfolio!, agent.positions, prices);
    } catch {
      return {
        equity: agent.portfolio!.cashUsd.minus(agent.portfolio!.borrowedUsd),
        marketValue: agent.portfolio!.cashUsd.minus(agent.portfolio!.cashUsd),
        positionNotional: agent.portfolio!.cashUsd.minus(agent.portfolio!.cashUsd),
        unrealizedPnl: agent.portfolio!.cashUsd.minus(agent.portfolio!.cashUsd),
        maintenanceRatio: null
      };
    }
  })();
  const equity = decimalToNumber(metrics.equity);

  const rows = agent.positions.map((position) => {
    const currentPrice = prices[position.coinId];
    const qty = Number(position.qty);
    const avgEntry = Number(position.avgEntryUsd);
    const marketValue = typeof currentPrice === "number" ? qty * currentPrice : null;
    const unrealizedPnl = typeof currentPrice === "number" ? (currentPrice - avgEntry) * qty : null;

    return {
      id: position.id,
      coinId: position.coinId,
      qty,
      avgEntry,
      currentPrice,
      marketValue,
      unrealizedPnl
    };
  });

  return (
    <main className="page-shell">
      <section className="card hero-card" style={{ marginBottom: "1rem" }}>
        <div className="button-row" style={{ marginBottom: "0.55rem" }}>
          <Link className="button button-secondary" href="/">
            ← Back to Dashboard
          </Link>
        </div>
        <h1 className="hero-title" style={{ fontSize: "1.8rem" }}>
          {agent.name}
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Holdings and portfolio snapshot
        </p>
        <div className="button-row">
          <span className="chip">{formatStyleLabel(agent.tradingStyle)}</span>
          {agent.bankrupt ? <span className="chip sentiment-bear">BANKRUPT</span> : null}
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 className="section-title">Portfolio</h2>
        <div className="stats-table-wrap">
          <table className="stats-table">
            <tbody>
              <tr>
                <th>Cash</th>
                <td className="numeric">{formatUsd(Number(agent.portfolio.cashUsd))}</td>
              </tr>
              <tr>
                <th>Borrowed</th>
                <td className="numeric">{formatUsd(Number(agent.portfolio.borrowedUsd))}</td>
              </tr>
              <tr>
                <th>Equity</th>
                <td className="numeric" style={{ fontWeight: 700 }}>
                  {formatUsd(equity)}
                </td>
              </tr>
              <tr>
                <th>Unrealized PnL</th>
                <td className={`numeric ${metrics.unrealizedPnl.gte(0) ? "pnl-up" : "pnl-down"}`}>
                  {formatUsd(decimalToNumber(metrics.unrealizedPnl))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Open Positions</h2>
        {rows.length ? (
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th className="numeric">Qty</th>
                  <th className="numeric">Avg Entry</th>
                  <th className="numeric">Current Price</th>
                  <th className="numeric">Market Value</th>
                  <th className="numeric">Unrealized PnL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.coinId}</td>
                    <td className="numeric">{row.qty.toFixed(6)}</td>
                    <td className="numeric">{formatUsd(row.avgEntry)}</td>
                    <td className="numeric">
                      {typeof row.currentPrice === "number" ? formatUsd(row.currentPrice) : "N/A"}
                    </td>
                    <td className="numeric">
                      {typeof row.marketValue === "number" ? formatUsd(row.marketValue) : "N/A"}
                    </td>
                    <td className={`numeric ${typeof row.unrealizedPnl === "number" && row.unrealizedPnl >= 0 ? "pnl-up" : "pnl-down"}`}>
                      {typeof row.unrealizedPnl === "number" ? formatUsd(row.unrealizedPnl) : "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No open positions.</p>
        )}
      </section>
    </main>
  );
}
