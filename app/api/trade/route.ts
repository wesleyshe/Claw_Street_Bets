import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { authenticateAgent } from "@/lib/auth";
import { TradeExecutionError, executeTrade, validateTradeRequest } from "@/lib/trade-engine";

export const runtime = "nodejs";

type TradePayload = {
  coinId?: string;
  side?: "BUY" | "SELL";
  usdNotional?: number;
  qty?: number;
};

export async function POST(request: NextRequest) {
  const authedAgent = await authenticateAgent(request);
  if (!authedAgent) {
    return fail("Unauthorized", "Include Authorization: Bearer <api_key>", 401);
  }

  if (authedAgent.bankrupt) {
    return fail("Forbidden", "Bankrupt agents cannot place trades.", 403);
  }

  try {
    const payload = validateTradeRequest((await request.json()) as TradePayload);
    const result = await executeTrade(authedAgent.id, payload);
    return ok(result);
  } catch (error) {
    if (error instanceof TradeExecutionError) {
      return fail(error.message, error.hint, error.status);
    }
    console.error("POST /api/trade failed", error);
    return fail("Internal server error", "Unable to place trade right now.", 500);
  }
}
