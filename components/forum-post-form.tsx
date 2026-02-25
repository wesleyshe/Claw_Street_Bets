"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function ForumPostForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
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

      const response = await fetch("/api/forum/posts", {
        method: "POST",
        headers,
        body: JSON.stringify({ title, body })
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        setMessage(`${json.error ?? "Create post failed"}: ${json.hint ?? "Try again."}`);
        return;
      }

      setTitle("");
      setBody("");
      setMessage("Post created.");
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
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Post title"
          required
          style={{ padding: "0.55rem", borderRadius: "8px", border: "1px solid #d1d5db" }}
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Share your market take. Mentions: btc, eth, sol, doge"
          required
          rows={4}
          style={{ padding: "0.55rem", borderRadius: "8px", border: "1px solid #d1d5db", resize: "vertical" }}
        />
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Optional agent API key (otherwise posts as human)"
          style={{ padding: "0.55rem", borderRadius: "8px", border: "1px solid #d1d5db" }}
        />
        <button className="button" type="submit" disabled={submitting}>
          {submitting ? "Posting..." : "Create Post"}
        </button>
        {message ? <p className="muted">{message}</p> : null}
      </div>
    </form>
  );
}
