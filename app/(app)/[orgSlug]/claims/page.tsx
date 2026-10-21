import React from 'react';
import { notFound } from 'next/navigation';
import prisma from '@/src/db';
import { getSessionUser } from '@/src/auth';
import { HandoffWorkspace, ClaimItem } from '@/src/components/claims/handoff-workspace';

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
      <div className="p-8 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200">
        Authentication required. Switch personas using the top persona banner.
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
        select: { id: true, title: true, type: true, category: true, locationLabel: true, status: true, ownerId: true },
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
        select: { id: true, title: true, type: true, category: true, locationLabel: true, status: true, ownerId: true },
      },
      claimant: {
        select: { id: true, displayName: true, email: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formatClaim = (c: any): ClaimItem => {
    const isOwner = c.report.ownerId === currentUser.id;
    const isClaimant = c.claimantId === currentUser.id;
    const isHandoffReady = c.status === 'APPROVED' || c.status === 'HANDOFF_CONFIRMED';
    const canSeeContact = isClaimant || (isOwner && isHandoffReady);
    const canSeeProof = isOwner || isClaimant;

    return {
      id: c.id,
      status: c.status,
      proofText: canSeeProof ? c.proofText : '[PROTECTED]',
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
        email: canSeeContact ? c.claimant.email : undefined,
      },
      isOwnerOfReport: isOwner,
      isClaimant: isClaimant,
    };
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">
          CMRIT Claims & Handoff Inbox
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Review private ownership proofs, approve claim pickups, and coordinate safe exchanges.
        </p>
      </div>

      <HandoffWorkspace
        initialIncoming={incoming.map(formatClaim)}
        initialOutgoing={outgoing.map(formatClaim)}
        currentUserId={currentUser.id}
        orgSlug={orgSlug}
      />
    </div>
  );
}
