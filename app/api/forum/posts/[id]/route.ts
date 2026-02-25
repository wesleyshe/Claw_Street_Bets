import { fail, ok } from "@/lib/api-response";
import { parseMentions } from "@/lib/forum";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = {
  params: { id: string };
};

export async function GET(_: Request, { params }: Params) {
  try {
    const post = await prisma.post.findUnique({
      where: { id: params.id },
      include: {
        agent: { select: { name: true } },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            agent: { select: { name: true } }
          }
        }
      }
    });

    if (!post) {
      return fail("Post not found", "That forum post does not exist.", 404);
    }

    return ok({
      post: {
        id: post.id,
        title: post.title,
        body: post.body,
        mentions: parseMentions(post.mentions),
        createdAt: post.createdAt.toISOString(),
        agent: post.agent ? { name: post.agent.name } : null,
        comments: post.comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          mentions: parseMentions(comment.mentions),
          createdAt: comment.createdAt.toISOString(),
          agent: comment.agent ? { name: comment.agent.name } : null
        }))
      }
    });
  } catch (error) {
    console.error("GET /api/forum/posts/[id] failed", error);
    return fail("Forum unavailable", "Unable to load this post right now.", 500);
  }
}
