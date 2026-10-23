import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/src/db';
import { getSessionUser } from '@/src/auth';
import { ModeratorConsole, FlaggedReportItem, AuditEventItem } from '@/src/components/moderation/moderator-console';
import { ShieldIcon, LockIcon } from '@/src/components/ui/icons';

interface ModerationPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function ModerationPage({ params }: ModerationPageProps) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    notFound();
  }

  const currentUser = await getSessionUser();
  let isModerator = false;
  let isAdmin = false;

  if (currentUser) {
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: currentUser.id,
        },
      },
    });
    if (membership && (membership.role === 'MODERATOR' || membership.role === 'ORG_ADMIN')) {
      isModerator = true;
    }
    if (membership && membership.role === 'ORG_ADMIN') {
      isAdmin = true;
    }
  }

  // Role Gate: if not moderator, render informative banner
  if (!isModerator) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <div className="bg-white rounded-3xl border border-slate-200/80 p-8 shadow-xs space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200/60 flex items-center justify-center mx-auto">
            <LockIcon className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Campus Safety Moderator Clearance Required
            </h2>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
              This console is scoped strictly to organization moderators and campus safety officers.
            </p>
          </div>

          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs text-indigo-900 text-left space-y-2">
            <div>
              <strong className="block font-bold">Campus Moderator Access Required:</strong>
              Sign in with an authorized campus security or administrator account such as{' '}
              <span className="font-semibold text-indigo-700">admin@cmrit.ac.in</span> on the Admin Login portal.
            </div>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-500 transition"
            >
              Go to Sign In Page →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Fetch flagged reports in org
  const flaggedReports = await prisma.report.findMany({
    where: {
      organizationId: org.id,
      moderationReports: { some: {} },
    },
    include: {
      moderationReports: {
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formattedReports: FlaggedReportItem[] = flaggedReports.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    category: r.category,
    title: r.title,
    description: r.description,
    locationLabel: r.locationLabel,
    createdAt: r.createdAt.toISOString(),
    flagsCount: r.moderationReports.length,
    flags: r.moderationReports.map((f) => ({
      id: f.id,
      reason: f.reason,
      createdAt: f.createdAt.toISOString(),
    })),
  }));

  // Fetch audit events
  const auditEvents = await prisma.auditEvent.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const formattedAudit: AuditEventItem[] = auditEvents.map((e) => ({
    id: e.id.toString(),
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    actorId: e.actorId || '',
    details: e.metadata,
    createdAt: e.createdAt.toISOString(),
  }));

  return (
    <ModeratorConsole
      initialReports={formattedReports}
      initialAuditEvents={formattedAudit}
      orgId={org.id}
      orgSlug={orgSlug}
      isAdmin={isAdmin}
    />
  );
}
