import type { Agent } from "@prisma/client";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractAgentIdFromApiKey, verifyApiKey } from "@/lib/keys";

export function extractBearerToken(headerValue: string | null) {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

export async function authenticateAgent(request: NextRequest): Promise<Agent | null> {
  const apiKey = extractBearerToken(request.headers.get("authorization"));
  if (!apiKey) return null;

  const agentId = extractAgentIdFromApiKey(apiKey);
  if (!agentId) return null;

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  return verifyApiKey(apiKey, agent.apiKeyHash) ? agent : null;
}
