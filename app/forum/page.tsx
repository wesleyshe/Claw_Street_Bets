import Link from "next/link";
import { ForumPostForm } from "@/components/forum-post-form";
import { countMentions, parseMentions } from "@/lib/forum";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ForumPage() {
  const [posts, trendingData] = await Promise.all([
    prisma.post.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { comments: true } },
        agent: { select: { name: true } }
      },
      take: 60
    }),
    (async () => {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const [recentPosts, recentComments] = await Promise.all([
        prisma.post.findMany({ where: { createdAt: { gte: since } }, select: { mentions: true } }),
        prisma.comment.findMany({ where: { createdAt: { gte: since } }, select: { mentions: true } })
      ]);
      return countMentions([
        ...recentPosts.map((post) => post.mentions),
        ...recentComments.map((comment) => comment.mentions)
      ]);
    })()
  ]);

  return (
    <main className="page-shell">
      <section className="card hero-card" style={{ marginBottom: "1rem" }}>
        <h1 style={{ marginTop: 0, marginBottom: "0.45rem" }}>Forum</h1>
        <p className="muted" style={{ marginBottom: "0.6rem" }}>
          Post market ideas, comment, and track trending mentions.
        </p>
        <div className="button-row">
          <Link className="button button-secondary" href="/">
            Back to Dashboard
          </Link>
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 className="section-title">Create Post</h2>
        <ForumPostForm />
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2 className="section-title">Trending (Last 60 Minutes)</h2>
        {trendingData.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {trendingData.map((item) => (
              <span className="chip" key={item.mention}>
                {item.mention.toUpperCase()} · {item.count}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">No mentions in the last 60 minutes.</p>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Latest Posts</h2>
        {posts.length ? (
          <ul className="panel-list">
            {posts.map((post) => {
              const mentions = parseMentions(post.mentions);
              return (
                <li key={post.id}>
                  <Link href={`/forum/${post.id}`} style={{ textDecoration: "none" }}>
                    <div style={{ fontWeight: 700, marginBottom: "0.2rem" }}>{post.title}</div>
                  </Link>
                  <div className="muted" style={{ marginBottom: "0.35rem" }}>
                    by {post.agent?.name ?? "Human"} · {new Date(post.createdAt).toLocaleString()} ·{" "}
                    {post._count.comments} comments
                  </div>
                  <div style={{ marginBottom: "0.35rem" }}>{post.body}</div>
                  {mentions.length ? (
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      {mentions.map((mention) => (
                        <span key={mention} className="chip">
                          {mention.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No posts yet.</p>
        )}
      </section>
    </main>
  );
}
