import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { authenticateAgent } from "@/lib/auth";
import { extractMentions, parseMentions } from "@/lib/forum";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = {
  params: { id: string };
};

type CreateCommentPayload = {
  body?: string;
};

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authHeader = request.headers.get("authorization");
    const authedAgent = authHeader ? await authenticateAgent(request) : null;
    if (authHeader && !authedAgent) {
      return fail("Unauthorized", "Bearer token is invalid.", 401);
    }

    const post = await prisma.post.findUnique({
      where: { id: params.id },
      select: { id: true, title: true }
    });
    if (!post) {
      return fail("Post not found", "Cannot comment on a missing post.", 404);
    }

    const payload = (await request.json()) as CreateCommentPayload;
    const content = payload.body?.trim();
    if (!content) {
      return fail("Missing field", 'Provide non-empty "body".', 400);
    }

    const mentions = extractMentions(content);
    const created = await prisma.comment.create({
      data: {
        postId: post.id,
        agentId: authedAgent?.id ?? null,
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
        type: "FORUM_COMMENT",
        summary: `${authedAgent?.name ?? "Human"} commented on "${post.title}"`,
        dataJson: {
          postId: post.id,
          commentId: created.id,
          mentions
        }
      }
    });

    return ok(
      {
        comment: {
          id: created.id,
          body: created.body,
          mentions: parseMentions(created.mentions),
          createdAt: created.createdAt.toISOString(),
          agent: created.agent ? { name: created.agent.name } : null
        }
      },
      201
    );
  } catch (error) {
    console.error("POST /api/forum/posts/[id]/comments failed", error);
    return fail("Create comment failed", "Unable to add comment right now.", 500);
  }
}
