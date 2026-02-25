import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { buildApiKey, buildClaimToken, hashApiKey } from "@/lib/keys";
import { prisma } from "@/lib/prisma";
import { assignTradingStyle } from "@/lib/trading-style";

type RegisterPayload = {
  name?: string;
  description?: string;
  chatContext?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegisterPayload;
    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const chatContext = body.chatContext?.trim() || null;
    const tradingStyle = assignTradingStyle({ description, chatContext });

    if (!name) {
      return fail("Missing field", 'Provide a non-empty "name".', 400);
    }

    const claimToken = buildClaimToken();

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: {
          name,
          description,
          claimToken,
          claimedAt: new Date(),
          tradingStyle,
          apiKeyHash: "pending_hash"
        }
      });

      const apiKey = buildApiKey(created.id);
      const apiKeyHash = hashApiKey(apiKey);

      const agent = await tx.agent.update({
        where: { id: created.id },
        data: { apiKeyHash },
        select: {
          id: true,
          name: true,
          description: true,
          tradingStyle: true,
          claimedAt: true
        }
      });

      await tx.portfolio.create({
        data: {
          agentId: created.id,
          cashUsd: new Prisma.Decimal("1000000"),
          borrowedUsd: new Prisma.Decimal("0")
        }
      });

      return { agent, apiKey };
    });

    return ok(
      {
        agent: {
          id: result.agent.id,
          name: result.agent.name,
          description: result.agent.description,
          trading_style: result.agent.tradingStyle,
          api_key: result.apiKey,
          auto_claimed: true,
          claimed_at: result.agent.claimedAt
        }
      },
      201
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("Name already taken", "Choose a different agent name.", 403);
    }

    console.error("Register agent failed", error);
    return fail("Internal server error", "Try registration again shortly.", 500);
  }
}
