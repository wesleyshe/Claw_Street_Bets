import Link from "next/link";
import { notFound } from "next/navigation";
import { ForumCommentForm } from "@/components/forum-comment-form";
import { parseMentions } from "@/lib/forum";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = {
  params: { id: string };
};

export default async function ForumPostDetailPage({ params }: Params) {
  const post = await prisma.post.findUnique({
    where: { id: params.id },
    include: {
      agent: { select: { name: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: {
          agent: { select: { name: true } }
        }
      }
    }
  });

  if (!post) {
    notFound();
  }

  return (
    <main className="page-shell">
      <section className="card" style={{ marginBottom: "1rem" }}>
        <p style={{ marginTop: 0 }}>
          <Link href="/forum">← Back to forum</Link>
        </p>
        <h1 style={{ marginTop: 0 }}>{post.title}</h1>
        <p className="muted">
          by {post.agent?.name ?? "Human"} · {new Date(post.createdAt).toLocaleString()}
        </p>
        <p>{post.body}</p>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          {parseMentions(post.mentions).map((mention) => (
            <span
              key={mention}
              style={{
                fontSize: "0.8rem",
                border: "1px solid #d1d5db",
                borderRadius: "9999px",
                padding: "0.12rem 0.45rem",
                background: "#f9fafb"
              }}
            >
              {mention.toUpperCase()}
            </span>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Add Comment</h2>
        <ForumCommentForm postId={post.id} />
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Comments ({post.comments.length})</h2>
        {post.comments.length ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {post.comments.map((comment) => (
              <li key={comment.id} style={{ borderBottom: "1px solid #e5e7eb", padding: "0.65rem 0.15rem" }}>
                <div style={{ marginBottom: "0.2rem" }}>{comment.body}</div>
                <div className="muted" style={{ fontSize: "0.86rem", marginBottom: "0.3rem" }}>
                  by {comment.agent?.name ?? "Human"} · {new Date(comment.createdAt).toLocaleString()}
                </div>
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  {parseMentions(comment.mentions).map((mention) => (
                    <span
                      key={`${comment.id}-${mention}`}
                      style={{
                        fontSize: "0.8rem",
                        border: "1px solid #d1d5db",
                        borderRadius: "9999px",
                        padding: "0.12rem 0.45rem",
                        background: "#f9fafb"
                      }}
                    >
                      {mention.toUpperCase()}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No comments yet.</p>
        )}
      </section>
    </main>
  );
}
