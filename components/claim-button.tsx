"use client";

import { useMemo, useState } from "react";

type ClaimButtonProps = {
  token: string;
  alreadyClaimed: boolean;
};

type ClaimResponse = {
  success: boolean;
  data?: {
    agent: {
      id: string;
      name: string;
      description: string | null;
      claimedAt: string | null;
    };
  };
  error?: string;
  hint?: string;
};

export function ClaimButton({ token, alreadyClaimed }: ClaimButtonProps) {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ClaimResponse | null>(null);

  const disabled = useMemo(() => loading || alreadyClaimed, [loading, alreadyClaimed]);

  async function onClaim() {
    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch("/api/agents/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });

      const json: ClaimResponse = await res.json();
      setResponse(json);
    } catch {
      setResponse({ success: false, error: "Network error", hint: "Try again in a moment." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" className="button" onClick={onClaim} disabled={disabled}>
        {alreadyClaimed ? "Already claimed" : loading ? "Claiming..." : "Claim agent"}
      </button>
      {response ? (
        <p style={{ marginTop: "0.75rem" }}>
          {response.success
            ? `Claim successful for ${response.data?.agent.name}.`
            : `${response.error ?? "Claim failed"} — ${response.hint ?? "Try again."}`}
        </p>
      ) : null}
    </div>
  );
}
