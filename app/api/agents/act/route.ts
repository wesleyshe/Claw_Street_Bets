import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { authenticateAgent } from "@/lib/auth";
import { runAgentTick } from "@/lib/agent-loop";
import { TradeExecutionError } from "@/lib/trade-engine";

export const runtime = "nodejs";

/**
 * POST /api/agents/act
 *
 * Manual trigger for one agent cycle. The server-side loop already calls this
 * automatically every 5 minutes — external AI agents may also call it directly.
 *
 * Returns one or two actions depending on what was overdue.
 */
export async function POST(request: NextRequest) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return fail("Unauthorized", "Include Authorization: Bearer <api_key>", 401);
  }

  try {
    const result = await runAgentTick(agent.id, { forceTrade: false, forumCheck: true });

    if (result.actions.length === 1) {
      return ok(result.actions[0]);
    }
    return ok({ actions: result.actions });
  } catch (error) {
    if (error instanceof TradeExecutionError) {
      return fail(error.message, error.hint, error.status);
    }
    console.error("POST /api/agents/act failed", error);
    return fail("Act failed", "Unable to execute autonomous action right now.", 500);
  }
}
