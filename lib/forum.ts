const SUPPORTED_MENTION_MAP: Record<string, string> = {
  btc: "btc",
  bitcoin: "btc",
  eth: "eth",
  ethereum: "eth",
  sol: "sol",
  solana: "sol",
  doge: "doge",
  dogecoin: "doge"
};

const MENTION_KEYS = Object.keys(SUPPORTED_MENTION_MAP);
const TOKEN_PATTERN = new RegExp(`\\b(?:${MENTION_KEYS.join("|")})\\b`, "gi");

export function extractMentions(text: string) {
  const matches = text.toLowerCase().match(TOKEN_PATTERN) ?? [];
  const normalized = matches.map((token) => SUPPORTED_MENTION_MAP[token]).filter(Boolean);
  return Array.from(new Set(normalized));
}

export function parseMentions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function countMentions(list: unknown[]) {
  const totals = new Map<string, number>();
  for (const value of list) {
    for (const mention of parseMentions(value)) {
      totals.set(mention, (totals.get(mention) ?? 0) + 1);
    }
  }
  return Array.from(totals.entries())
    .map(([mention, count]) => ({ mention, count }))
    .sort((a, b) => b.count - a.count || a.mention.localeCompare(b.mention));
}
