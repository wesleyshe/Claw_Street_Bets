import { fail, ok } from "@/lib/api-response";
import { getRecentActivity } from "@/lib/community";

export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await getRecentActivity(40);
    return ok({ activity: items });
  } catch (error) {
    console.error("GET /api/activity failed", error);
    return fail("Activity unavailable", "Unable to fetch recent activity right now.", 500);
  }
}
