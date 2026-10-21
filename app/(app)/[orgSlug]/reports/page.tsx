import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/src/db';
import { getSessionUser } from '@/src/auth';
import { ReportCard, ReportItem } from '@/src/components/reports/report-card';
import { ReportFilterBar } from '@/src/components/reports/report-filter-bar';
import { PlusIcon } from '@/src/components/ui/icons';

interface ReportsPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    type?: string;
    category?: string;
    q?: string;
    locationArea?: string;
  }>;
}

export default async function ReportsPage({ params, searchParams }: ReportsPageProps) {
  const { orgSlug } = await params;
  const { type, category, q, locationArea } = await searchParams;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    notFound();
  }

  const currentUser = await getSessionUser();

  // Build query filters (only active OPEN reports appear in the discovery feed)
  const where: any = {
    organizationId: org.id,
    status: 'OPEN',
  };

  if (type && (type === 'LOST' || type === 'FOUND')) {
    where.type = type;
  }

  if (category) {
    where.category = category;
  }

  if (locationArea) {
    where.locationArea = { contains: locationArea, mode: 'insensitive' };
  }

  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { brand: { contains: q, mode: 'insensitive' } },
      { locationLabel: { contains: q, mode: 'insensitive' } },
    ];
  }

  const reports = await prisma.report.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      images: {
        where: { status: { in: ['READY', 'PROCESSING'] } },
        orderBy: { createdAt: 'asc' },
      },
      claims: {
        select: { id: true, status: true },
      },
      lostMatches: {
        select: { id: true },
      },
      foundMatches: {
        select: { id: true },
      },
    },
    take: 50,
  });

  const formattedReports: ReportItem[] = reports.map((r) => {
    const isOwner = currentUser ? r.ownerId === currentUser.id : false;
    const matchesCount = r.type === 'LOST' ? r.lostMatches.length : r.foundMatches.length;

    return {
      id: r.id,
      type: r.type as 'LOST' | 'FOUND',
      status: r.status as any,
      category: r.category,
      title: r.title,
      description: r.description,
      brand: r.brand,
      color: r.color,
      locationLabel: r.locationLabel,
      locationArea: r.locationArea,
      createdAt: r.createdAt.toISOString(),
      ownerId: r.ownerId,
      images: r.images.map((img) => ({
        id: img.id,
        url: `/api/v1/images/${img.id}`,
        status: img.status as any,
      })),
      claimsCount: r.claims.length,
      matchesCount,
      isOwner,
    };
  });

  return (
    <div className="space-y-6">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-indigo-900 to-slate-900 text-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-800">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 mb-3">
            <span>🛡️ Campus Verified System</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Campus Lost & Found Feed
          </h1>
          <p className="text-sm text-slate-300 max-w-xl mt-1.5 leading-relaxed">
            Report lost items, browse found property, and let the deterministic engine compute instant candidate matches across {org.name}.
          </p>
        </div>

        <Link
          href={`/${orgSlug}/reports/new`}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-md transition shrink-0 cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          <span>Post an Item</span>
        </Link>
      </div>

      {/* How It Works Guidance Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-slate-50 border border-slate-200/80 rounded-2xl">
        <div className="flex items-start gap-3 p-2">
          <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
            1
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Post or Browse</h4>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Report a lost item or post property you found on campus with photo and zone.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-2">
          <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
            2
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Instant Matching</h4>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Our deterministic scoring engine computes candidate matches in real time.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-2">
          <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
            3
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Claim & Secure Return</h4>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Submit proof, unlock gated handoff chat upon approval, and confirm safe return.
            </p>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <ReportFilterBar />

      {/* Listings Grid */}
      {formattedReports.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl mb-4">
            🔍
          </div>
          <h3 className="text-base font-bold text-slate-900">No items found</h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1 leading-relaxed">
            No active reports match your current search or category filters. Try resetting filters or post a new item.
          </p>
          <Link
            href={`/${orgSlug}/reports/new`}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition"
          >
            <PlusIcon className="w-4 h-4" />
            <span>Post New Report</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {formattedReports.map((report) => (
            <ReportCard key={report.id} report={report} orgSlug={orgSlug} />
          ))}
        </div>
      )}
    </div>
  );
}
