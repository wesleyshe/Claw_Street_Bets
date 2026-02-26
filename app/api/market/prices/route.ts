import { fail, ok } from "@/lib/api-response";
import { getMarketPrices } from "@/lib/market";
import { ensureAllAgentLoops } from "@/lib/agent-loop";

export const runtime = "nodejs";

// Trigger agent loops on cold start (first request after server boot)
void ensureAllAgentLoops().catch(console.error);

export async function GET() {
  try {
    const market = await getMarketPrices();
    return ok(market);
  } catch (error) {
    console.error("GET /api/market/prices failed", error);
    return fail("Market unavailable", "Unable to fetch market prices right now.", 500);
  }
}
