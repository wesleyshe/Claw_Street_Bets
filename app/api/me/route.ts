import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { authenticateAgent } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) {
      return fail("Unauthorized", "Include Authorization: Bearer <api_key>", 401);
    }

    const portfolio = await prisma.portfolio.findUnique({
      where: { agentId: agent.id },
      select: {
        cashUsd: true,
        borrowedUsd: true,
        updatedAt: true
      }
    });

    if (!portfolio) {
      return fail("Portfolio missing", "Agent portfolio not found.", 404);
    }

    return ok({
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        tradingStyle: agent.tradingStyle,
        bankrupt: agent.bankrupt,
        claimedAt: agent.claimedAt,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        lastActAt: agent.lastActAt
      },
      portfolio
    });
  } catch (error) {
    console.error("Fetch /api/me failed", error);
    return fail("Internal server error", "Try again shortly.", 500);
  }
}
