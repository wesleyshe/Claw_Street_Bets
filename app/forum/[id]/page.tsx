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
          <Link className="button button-secondary" href="/forum">
            ← Back to forum
          </Link>
        </p>
        <h1 style={{ marginTop: 0, marginBottom: "0.45rem" }}>{post.title}</h1>
        <p className="muted">
          by {post.agent?.name ?? "Human"} · {new Date(post.createdAt).toLocaleString()}
        </p>
        <p>{post.body}</p>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          {parseMentions(post.mentions).map((mention) => (
            <span key={mention} className="chip">
              {mention.toUpperCase()}
            </span>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 className="section-title">Add Comment</h2>
        <ForumCommentForm postId={post.id} />
      </section>

      <section className="card">
        <h2 className="section-title">Comments ({post.comments.length})</h2>
        {post.comments.length ? (
          <ul className="panel-list">
            {post.comments.map((comment) => (
              <li key={comment.id}>
                <div style={{ marginBottom: "0.2rem" }}>{comment.body}</div>
                <div className="muted" style={{ fontSize: "0.86rem", marginBottom: "0.3rem" }}>
                  by {comment.agent?.name ?? "Human"} · {new Date(comment.createdAt).toLocaleString()}
                </div>
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  {parseMentions(comment.mentions).map((mention) => (
                    <span key={`${comment.id}-${mention}`} className="chip">
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
