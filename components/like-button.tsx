"use client";

import { useState } from "react";

export function LikeButton({ postId, initialLikes }: { postId: string; initialLikes: number }) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLike() {
    if (liked || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/forum/posts/${postId}/like`, { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as { data: { likes: number } };
        setLikes(data.data.likes);
        setLiked(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className={`like-btn${liked ? " liked" : ""}`}
      onClick={handleLike}
      disabled={liked || loading}
      title={liked ? "Liked" : "Like this post"}
    >
      {liked ? "♥" : "♡"} {likes}
    </button>
  );
}
