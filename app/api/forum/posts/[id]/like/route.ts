import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = { params: { id: string } };

/** POST /api/forum/posts/:id/like — anyone can like a post, no auth required */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const post = await prisma.post.update({
      where: { id: params.id },
      data: { likes: { increment: 1 } },
      select: { id: true, likes: true }
    });
    return ok({ postId: post.id, likes: post.likes });
  } catch {
    return fail("Like failed", "Post not found or unable to like right now.", 404);
  }
}
