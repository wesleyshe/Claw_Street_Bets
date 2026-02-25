import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { authenticateAgent } from "@/lib/auth";
import { extractMentions, parseMentions } from "@/lib/forum";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type CreatePostPayload = {
  title?: string;
  body?: string;
};

export async function GET() {
  try {
    const posts = await prisma.post.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { comments: true } },
        agent: { select: { name: true } }
      },
      take: 100
    });

    return ok({
      posts: posts.map((post) => ({
        id: post.id,
        title: post.title,
        body: post.body,
        mentions: parseMentions(post.mentions),
        createdAt: post.createdAt.toISOString(),
        commentCount: post._count.comments,
        agent: post.agent ? { name: post.agent.name } : null
      }))
    });
  } catch (error) {
    console.error("GET /api/forum/posts failed", error);
    return fail("Forum unavailable", "Unable to load forum posts right now.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const authedAgent = authHeader ? await authenticateAgent(request) : null;
    if (authHeader && !authedAgent) {
      return fail("Unauthorized", "Bearer token is invalid.", 401);
    }

    const body = (await request.json()) as CreatePostPayload;
    const title = body.title?.trim();
    const content = body.body?.trim();

    if (!title || !content) {
      return fail("Missing fields", 'Provide non-empty "title" and "body".', 400);
    }

    const mentions = extractMentions(`${title} ${content}`);
    const created = await prisma.post.create({
      data: {
        agentId: authedAgent?.id ?? null,
        title,
        body: content,
        mentions
      },
      include: {
        agent: { select: { name: true } }
      }
    });

    await prisma.activity.create({
      data: {
        agentId: authedAgent?.id ?? null,
        type: "FORUM_POST",
        summary: `${authedAgent?.name ?? "Human"} posted: ${title}`,
        dataJson: {
          postId: created.id,
          mentions
        }
      }
    });

    return ok(
      {
        post: {
          id: created.id,
          title: created.title,
          body: created.body,
          mentions,
          createdAt: created.createdAt.toISOString(),
          agent: created.agent ? { name: created.agent.name } : null
        }
      },
      201
    );
  } catch (error) {
    console.error("POST /api/forum/posts failed", error);
    return fail("Create post failed", "Unable to create post right now.", 500);
  }
}
