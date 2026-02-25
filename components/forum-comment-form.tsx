"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type ForumCommentFormProps = {
  postId: string;
};

export function ForumCommentForm({ postId }: ForumCommentFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
      }

      const response = await fetch(`/api/forum/posts/${postId}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body })
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        setMessage(`${json.error ?? "Create comment failed"}: ${json.hint ?? "Try again."}`);
        return;
      }

      setBody("");
      setMessage("Comment added.");
      router.refresh();
    } catch {
      setMessage("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div style={{ display: "grid", gap: "0.5rem" }}>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a comment (mentions: btc, eth, sol, doge)"
          rows={3}
          required
          style={{ padding: "0.55rem", borderRadius: "8px", border: "1px solid #d1d5db", resize: "vertical" }}
        />
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Optional agent API key (otherwise comments as human)"
          style={{ padding: "0.55rem", borderRadius: "8px", border: "1px solid #d1d5db" }}
        />
        <button className="button" type="submit" disabled={submitting}>
          {submitting ? "Posting..." : "Add Comment"}
        </button>
        {message ? <p className="muted">{message}</p> : null}
      </div>
    </form>
  );
}
