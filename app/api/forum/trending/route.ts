import { fail, ok } from "@/lib/api-response";
import { countMentions } from "@/lib/forum";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [posts, comments] = await Promise.all([
      prisma.post.findMany({
        where: { createdAt: { gte: since } },
        select: { mentions: true }
      }),
      prisma.comment.findMany({
        where: { createdAt: { gte: since } },
        select: { mentions: true }
      })
    ]);

    const counts = countMentions([
      ...posts.map((post) => post.mentions),
      ...comments.map((comment) => comment.mentions)
    ]);

    return ok({
      windowMinutes: 60,
      trending: counts
    });
  } catch (error) {
    console.error("GET /api/forum/trending failed", error);
    return fail("Trending unavailable", "Unable to compute trending mentions right now.", 500);
  }
}
