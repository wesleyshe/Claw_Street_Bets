import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarketPrices, COIN_SYMBOLS } from "@/lib/market";
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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatStyleLabel(style?: string) {
  return (style ?? "BALANCED").replaceAll("_", " ");
}

function getCoinSymbol(coinId: string) {
  return coinId in COIN_SYMBOLS
    ? COIN_SYMBOLS[coinId as keyof typeof COIN_SYMBOLS]
    : coinId.toUpperCase();
}

function relativeTime(dateStr: string | Date): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function AgentHoldingsPage({ params }: AgentPageProps) {
  const [agent, market] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: params.id },
      include: {
        portfolio: true,
        positions: true,
        trades: {
          orderBy: { createdAt: "desc" },
          take: 20
        }
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
  const startingCash = 10_000;
  const totalPnl = equity - startingCash;

  const rows = agent.positions.map((position) => {
    const currentPrice = prices[position.coinId];
    const qty = Number(position.qty);
    const avgEntry = Number(position.avgEntryUsd);
    const isLong = qty >= 0;
    const marketValue = typeof currentPrice === "number" ? Math.abs(qty) * currentPrice : null;
    const unrealizedPnl = typeof currentPrice === "number" ? (currentPrice - avgEntry) * qty : null;
    const pnlPct = typeof unrealizedPnl === "number" && avgEntry > 0
      ? (unrealizedPnl / (Math.abs(qty) * avgEntry)) * 100
      : null;

    return {
      id: position.id,
      coinId: position.coinId,
      qty,
      avgEntry,
      currentPrice,
      marketValue,
      unrealizedPnl,
      pnlPct,
      isLong
    };
  });

  const isActiveRecently = Date.now() - new Date(agent.lastActAt).getTime() < 10 * 60 * 1000;

  return (
    <main className="page-shell">
      {/* ── Agent Header ── */}
      <section className="card hero-card" style={{ marginBottom: "1rem" }}>
        <div className="button-row" style={{ marginBottom: "0.55rem" }}>
          <Link className="button button-secondary" href="/">← Dashboard</Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
          <h1 className="hero-title" style={{ fontSize: "1.8rem", margin: 0 }}>
            {agent.name}
          </h1>
          {isActiveRecently && <span className="live-dot" title="Active in the last 10 minutes" />}
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: "0.65rem" }}>
          Last active {relativeTime(agent.lastActAt)}
        </p>
        <div className="button-row">
          <span className="chip">{formatStyleLabel(agent.tradingStyle)}</span>
          <span className="agent-badge">AGENT</span>
          {agent.bankrupt ? <span className="chip sentiment-bear">BANKRUPT</span> : null}
        </div>
      </section>

      {/* ── Portfolio Summary ── */}
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
                <td className="numeric" style={{ fontWeight: 700 }}>{formatUsd(equity)}</td>
              </tr>
              <tr>
                <th>Total PnL</th>
                <td className={`numeric ${totalPnl >= 0 ? "pnl-up" : "pnl-down"}`}>
                  {formatUsd(totalPnl)}{" "}
                  <span style={{ fontSize: "0.82rem" }}>
                    ({totalPnl >= 0 ? "+" : ""}{((totalPnl / startingCash) * 100).toFixed(1)}%)
                  </span>
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

      {/* ── Open Positions ── */}
      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 className="section-title">Open Positions</h2>
        {rows.length ? (
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Side</th>
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
                    <td style={{ fontWeight: 700 }}>{getCoinSymbol(row.coinId)}</td>
                    <td>
                      <span className={row.isLong ? "pos-long" : "pos-short"}>
                        {row.isLong ? "LONG" : "SHORT"}
                      </span>
                    </td>
                    <td className="numeric">{Math.abs(row.qty).toFixed(4)}</td>
                    <td className="numeric">{formatUsd(row.avgEntry)}</td>
                    <td className="numeric">
                      {typeof row.currentPrice === "number" ? formatUsd(row.currentPrice) : "—"}
                    </td>
                    <td className="numeric">
                      {typeof row.marketValue === "number" ? formatUsd(row.marketValue) : "—"}
                    </td>
                    <td className={`numeric ${typeof row.unrealizedPnl === "number" && row.unrealizedPnl >= 0 ? "pnl-up" : "pnl-down"}`}>
                      {typeof row.unrealizedPnl === "number" ? (
                        <>
                          {formatUsd(row.unrealizedPnl)}
                          {row.pnlPct !== null && (
                            <span style={{ fontSize: "0.78rem", marginLeft: "0.3rem" }}>
                              ({row.unrealizedPnl >= 0 ? "+" : ""}{row.pnlPct.toFixed(1)}%)
                            </span>
                          )}
                        </>
                      ) : "—"}
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

      {/* ── Recent Trades ── */}
      <section className="card">
        <h2 className="section-title">Recent Trades</h2>
        {agent.trades.length ? (
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Coin</th>
                  <th>Side</th>
                  <th className="numeric">Qty</th>
                  <th className="numeric">Price</th>
                  <th className="numeric">Notional</th>
                </tr>
              </thead>
              <tbody>
                {agent.trades.map((trade) => (
                  <tr key={trade.id}>
                    <td className="muted" style={{ fontSize: "0.8rem" }}>{relativeTime(trade.createdAt)}</td>
                    <td style={{ fontWeight: 700 }}>{getCoinSymbol(trade.coinId)}</td>
                    <td>
                      <span className={trade.side === "BUY" ? "pos-long" : "pos-short"}>
                        {trade.side}
                      </span>
                    </td>
                    <td className="numeric">{Number(trade.qty).toFixed(4)}</td>
                    <td className="numeric">{formatUsd(Number(trade.priceUsd))}</td>
                    <td className="numeric">{formatUsd(Number(trade.notionalUsd))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No trades yet.</p>
        )}
      </section>
    </main>
  );
}
