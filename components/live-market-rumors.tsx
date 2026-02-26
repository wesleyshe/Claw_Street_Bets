"use client";

import { useEffect, useState } from "react";
import { COIN_SYMBOLS } from "@/lib/market";

type MarketEventView = {
  id: string;
  headline: string;
  body: string;
  sentiment: "BULL" | "BEAR" | "NEUTRAL";
  coinId: string | null;
  createdAt: string;
  expiresAt: string;
};

type EventsApiResponse = {
  success: boolean;
  data?: { events?: MarketEventView[] };
};

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getCoinSymbol(coinId: string) {
  return coinId in COIN_SYMBOLS
    ? COIN_SYMBOLS[coinId as keyof typeof COIN_SYMBOLS]
    : coinId.toUpperCase();
}

export function LiveMarketRumors({
  initialEvents,
  className
}: {
  initialEvents: MarketEventView[];
  className?: string;
}) {
  const [events, setEvents] = useState(initialEvents);
  const sectionClass = className ? `card ${className}` : "card";

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        const response = await fetch("/api/market/events", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as EventsApiResponse;
        const nextEvents = payload?.success ? payload.data?.events : null;
        if (!mounted || !Array.isArray(nextEvents)) return;
        setEvents(nextEvents);
      } catch {
        // Keep current events if fetch fails.
      }
    };

    const timer = window.setInterval(() => {
      void refresh();
    }, 60_000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className={sectionClass}>
      <h2 className="section-title">Market Rumors</h2>
      {events.length ? (
        <ul className="panel-list">
          {events.slice(0, 5).map((event) => (
            <li key={event.id}>
              <div style={{ fontWeight: 700, marginBottom: "0.18rem" }}>{event.headline}</div>
              <div className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.3rem" }}>{event.body}</div>
              <div className="button-row" style={{ gap: "0.35rem" }}>
                <span className={`chip ${event.sentiment === "BULL" ? "sentiment-bull" : event.sentiment === "BEAR" ? "sentiment-bear" : "sentiment-neutral"}`}>
                  {event.sentiment}
                </span>
                {event.coinId ? <span className="chip">{getCoinSymbol(event.coinId)}</span> : <span className="chip">MACRO</span>}
                <span className="muted" style={{ fontSize: "0.76rem" }}>updated {relativeTime(event.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No active rumors.</p>
      )}
    </section>
  );
}
