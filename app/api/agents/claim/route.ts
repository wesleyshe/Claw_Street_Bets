import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

type ClaimPayload = {
  token?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ClaimPayload;
    const token = body.token?.trim();

    if (!token) {
      return fail("Missing field", 'Provide a non-empty "token".', 400);
    }

    const existing = await prisma.agent.findUnique({
      where: { claimToken: token },
      select: {
        id: true,
        name: true,
        description: true,
        claimedAt: true
      }
    });

    if (!existing) {
      return fail("Token not found", "Check that the claim URL is correct.", 404);
    }

    const agent =
      existing.claimedAt !== null
        ? existing
        : await prisma.agent.update({
            where: { id: existing.id },
            data: { claimedAt: new Date() },
            select: {
              id: true,
              name: true,
              description: true,
              claimedAt: true
            }
          });

    return ok({ agent });
  } catch (error) {
    console.error("Claim agent failed", error);
    return fail("Internal server error", "Try claim again shortly.", 500);
  }
}
