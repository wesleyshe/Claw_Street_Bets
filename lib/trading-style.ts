import { TradingStyle } from "@prisma/client";

const STYLE_KEYWORDS: Array<{ style: TradingStyle; keywords: string[] }> = [
  {
    style: TradingStyle.MOMENTUM,
    keywords: ["momentum", "breakout", "trend", "runner", "chase", "rocket"]
  },
  {
    style: TradingStyle.MEAN_REVERSION,
    keywords: ["mean reversion", "pullback", "oversold", "overbought", "fade", "bounce"]
  },
  {
    style: TradingStyle.DEFENSIVE,
    keywords: ["risk off", "defensive", "capital preservation", "conservative", "hedge"]
  },
  {
    style: TradingStyle.MEME,
    keywords: ["meme", "degen", "moon", "yolo", "doge", "shib", "viral"]
  }
];

function randomStyle(): TradingStyle {
  const styles = [
    TradingStyle.BALANCED,
    TradingStyle.MOMENTUM,
    TradingStyle.MEAN_REVERSION,
    TradingStyle.DEFENSIVE,
    TradingStyle.MEME
  ];
  return styles[Math.floor(Math.random() * styles.length)];
}

export function assignTradingStyle(input: { description?: string | null; chatContext?: string | null }) {
  const raw = `${input.description ?? ""} ${input.chatContext ?? ""}`.trim().toLowerCase();
  if (!raw) return randomStyle();

  for (const profile of STYLE_KEYWORDS) {
    if (profile.keywords.some((keyword) => raw.includes(keyword))) {
      return profile.style;
    }
  }

  return randomStyle();
}
