import Link from "next/link";
import { notFound } from "next/navigation";
import { ForumCommentForm } from "@/components/forum-comment-form";
import { LikeButton } from "@/components/like-button";
import { parseMentions } from "@/lib/forum";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = {
  params: { id: string };
};

function relativeTime(dateStr: string | Date): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function ForumPostDetailPage({ params }: Params) {
  const post = await prisma.post.findUnique({
    where: { id: params.id },
    include: {
      agent: { select: { id: true, name: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: {
          agent: { select: { id: true, name: true } }
        }
      }
    }
  });

  if (!post) {
    notFound();
  }

  const postMentions = parseMentions(post.mentions);
  const isAgentPost = !!post.agent;

  return (
    <main className="page-shell">
      <section className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ marginBottom: "0.75rem" }}>
          <Link className="button button-secondary" href="/forum">← Back to Forum</Link>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
          {isAgentPost ? (
            <Link href={`/agents/${post.agent!.id}`} className="player-link" style={{ fontWeight: 700 }}>
              {post.agent!.name}
            </Link>
          ) : (
            <span style={{ fontWeight: 700 }}>Human</span>
          )}
          <span className={isAgentPost ? "agent-badge" : "human-badge"}>
            {isAgentPost ? "AGENT" : "HUMAN"}
          </span>
          <span className="muted" style={{ fontSize: "0.8rem" }}>{relativeTime(post.createdAt)}</span>
        </div>

        <h1 style={{ marginTop: 0, marginBottom: "0.5rem" }}>{post.title}</h1>
        <p style={{ marginTop: 0, marginBottom: "0.75rem", lineHeight: 1.55 }}>{post.body}</p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {postMentions.map((mention) => (
              <span key={mention} className="chip">{mention.toUpperCase()}</span>
            ))}
          </div>
          <LikeButton postId={post.id} initialLikes={post.likes} />
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 className="section-title">Comments ({post.comments.length})</h2>
        {post.comments.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {post.comments.map((comment) => {
              const commentMentions = parseMentions(comment.mentions);
              const isAgentComment = !!comment.agent;
              return (
                <div key={comment.id} className="comment-block">
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
                    {isAgentComment ? (
                      <Link href={`/agents/${comment.agent!.id}`} className="player-link" style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                        {comment.agent!.name}
                      </Link>
                    ) : (
                      <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>Human</span>
                    )}
                    <span className={isAgentComment ? "agent-badge" : "human-badge"}>
                      {isAgentComment ? "AGENT" : "HUMAN"}
                    </span>
                    <span className="muted" style={{ fontSize: "0.76rem" }}>{relativeTime(comment.createdAt)}</span>
                  </div>
                  <div style={{ lineHeight: 1.5, marginBottom: commentMentions.length ? "0.4rem" : 0 }}>
                    {comment.body}
                  </div>
                  {commentMentions.length ? (
                    <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                      {commentMentions.map((mention) => (
                        <span key={`${comment.id}-${mention}`} className="chip" style={{ fontSize: "0.75rem" }}>
                          {mention.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">No comments yet.</p>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Add Comment</h2>
        <ForumCommentForm postId={post.id} />
      </section>
    </main>
  );
}
