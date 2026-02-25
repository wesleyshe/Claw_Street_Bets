import { fail, ok } from "@/lib/api-response";
import { getMarketPrices } from "@/lib/market";

export const runtime = "nodejs";

export async function GET() {
  try {
    const market = await getMarketPrices();
    return ok(market);
  } catch (error) {
    console.error("GET /api/market/prices failed", error);
    return fail("Market unavailable", "Unable to fetch market prices right now.", 500);
  }
}
