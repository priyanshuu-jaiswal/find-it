import React from 'react';
import { notFound } from 'next/navigation';
import prisma from '@/src/db';
import { getSessionUser } from '@/src/auth';
import { ClaimsInboxWorkspace, ClaimItem } from '@/src/components/claims/claims-inbox-workspace';

interface ClaimsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function ClaimsPage({ params }: ClaimsPageProps) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    notFound();
  }

  const currentUser = await getSessionUser();
  if (!currentUser) {
    return (
      <div className="p-8 text-center text-xs text-slate-500 bg-white rounded-3xl border border-slate-200">
        Authentication required. Switch personas using the bottom-right dock.
      </div>
    );
  }

  // 1. Incoming Claims: claims on reports where currentUser is owner
  const incoming = await prisma.claim.findMany({
    where: {
      report: {
        organizationId: org.id,
        ownerId: currentUser.id,
      },
    },
    include: {
      report: {
        select: { id: true, title: true, type: true, category: true, locationLabel: true, status: true },
      },
      claimant: {
        select: { id: true, displayName: true, email: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // 2. Outgoing Claims: claims submitted by currentUser
  const outgoing = await prisma.claim.findMany({
    where: {
      claimantId: currentUser.id,
      report: {
        organizationId: org.id,
      },
    },
    include: {
      report: {
        select: { id: true, title: true, type: true, category: true, locationLabel: true, status: true },
      },
      claimant: {
        select: { id: true, displayName: true, email: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formatClaim = (c: any): ClaimItem => ({
    id: c.id,
    status: c.status,
    proofText: c.proofText,
    decisionNote: c.decisionNote,
    createdAt: c.createdAt.toISOString(),
    decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
    report: {
      id: c.report.id,
      type: c.report.type,
      title: c.report.title,
      category: c.report.category,
      locationLabel: c.report.locationLabel,
      status: c.report.status,
    },
    claimant: {
      id: c.claimant.id,
      displayName: c.claimant.displayName,
      email: c.claimant.email,
    },
    isOwnerOfReport: c.report.ownerId === currentUser.id,
    isClaimant: c.claimantId === currentUser.id,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Claims & Handoff Inbox
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage ownership proofs, approve handoff pickups, and coordinate safe exchanges.
          </p>
        </div>
      </div>

      <ClaimsInboxWorkspace
        initialIncoming={incoming.map(formatClaim)}
        initialOutgoing={outgoing.map(formatClaim)}
        currentUserId={currentUser.id}
        orgSlug={orgSlug}
      />
    </div>
  );
}
