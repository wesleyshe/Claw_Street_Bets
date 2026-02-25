import { notFound } from "next/navigation";
import { ClaimButton } from "@/components/claim-button";
import { prisma } from "@/lib/prisma";

type ClaimPageProps = {
  params: {
    token: string;
  };
};

export default async function ClaimPage({ params }: ClaimPageProps) {
  const agent = await prisma.agent.findUnique({
    where: { claimToken: params.token },
    select: {
      id: true,
      name: true,
      description: true,
      claimedAt: true,
      createdAt: true
    }
  });

  if (!agent) {
    notFound();
  }

  return (
    <main className="page-shell">
      <section className="card">
        <h1 style={{ marginTop: 0 }}>Claim Agent</h1>
        <p>
          <strong>Name:</strong> {agent.name}
        </p>
        <p>
          <strong>Description:</strong> {agent.description ?? "No description set"}
        </p>
        <p className="muted">
          Registered: {new Date(agent.createdAt).toLocaleString()} | Claimed: {" "}
          {agent.claimedAt ? new Date(agent.claimedAt).toLocaleString() : "Not yet"}
        </p>
        <ClaimButton token={params.token} alreadyClaimed={Boolean(agent.claimedAt)} />
      </section>
    </main>
  );
}
