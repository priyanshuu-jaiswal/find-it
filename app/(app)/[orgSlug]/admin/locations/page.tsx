import React from 'react';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import prisma from '@/src/db';
import { getSessionUser } from '@/src/auth';
import { CampusLocationsManager } from '@/src/components/admin/campus-locations-manager';
import { ShieldIcon, LockIcon } from '@/src/components/ui/icons';

interface AdminLocationsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AdminLocationsPage({ params }: AdminLocationsPageProps) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    notFound();
  }

  const currentUser = await getSessionUser();
  if (!currentUser) {
    redirect('/login');
  }

  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: currentUser.id,
      },
    },
  });

  const isAdmin = membership?.role === 'ORG_ADMIN';

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <div className="bg-white rounded-3xl border border-slate-200/80 p-8 shadow-xs space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200/60 flex items-center justify-center mx-auto">
            <LockIcon className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Campus Administrator Clearance Required
            </h2>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
              Adding and modifying official campus locations is restricted strictly to campus administrators.
            </p>
          </div>

          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs text-indigo-900 text-left space-y-2">
            <div>
              <strong className="block font-bold">Sign In as Campus Administrator:</strong>
              Use your campus administrator account such as{' '}
              <span className="font-semibold text-indigo-700">admin@cmrit.ac.in</span> to manage locations.
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href={`/${orgSlug}/moderation`}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
        >
          ← Back to Moderator Console
        </Link>
      </div>

      <CampusLocationsManager orgId={org.id} orgSlug={orgSlug} />
    </div>
  );
}
