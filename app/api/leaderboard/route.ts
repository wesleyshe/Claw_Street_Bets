import { fail, ok } from "@/lib/api-response";
import { getLeaderboardData } from "@/lib/community";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await getLeaderboardData();
    return ok(data);
  } catch (error) {
    console.error("GET /api/leaderboard failed", error);
    return fail("Leaderboard unavailable", "Unable to compute leaderboard right now.", 500);
  }
}
