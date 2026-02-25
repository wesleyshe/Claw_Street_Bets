import { fail, ok } from "@/lib/api-response";
import { getActiveMarketEvents } from "@/lib/market-events";

export const runtime = "nodejs";

export async function GET() {
  try {
    const events = await getActiveMarketEvents();
    return ok({ events });
  } catch (error) {
    console.error("GET /api/market/events failed", error);
    return fail("Events unavailable", "Unable to load market rumors right now.", 500);
  }
}
