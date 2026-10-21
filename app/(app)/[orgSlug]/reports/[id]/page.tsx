import React from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import prisma from '@/src/db';
import { getSessionUser } from '@/src/auth';
import { MatchCandidateCard, MatchCandidate } from '@/src/components/matching/match-candidate-card';
import { ReportDetailActions } from '@/src/components/reports/report-detail-actions';
import { ShieldIcon, MapPinIcon, ClockIcon, LockIcon, SparklesIcon, TagIcon } from '@/src/components/ui/icons';

interface ReportDetailPageProps {
  params: Promise<{ orgSlug: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function ReportDetailPage({ params, searchParams }: ReportDetailPageProps) {
  const { orgSlug, id } = await params;
  const { tab } = await searchParams;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    notFound();
  }

  const report = await prisma.report.findFirst({
    where: { id, organizationId: org.id },
    include: {
      images: {
        where: { status: { in: ['READY', 'PROCESSING'] } },
        orderBy: { createdAt: 'asc' },
      },
      claims: {
        select: { id: true, status: true, claimantId: true, createdAt: true },
      },
      lostMatches: {
        include: {
          foundReport: {
            include: {
              images: { where: { status: 'READY' } },
            },
          },
        },
        orderBy: { score: 'desc' },
      },
      foundMatches: {
        include: {
          lostReport: {
            include: {
              images: { where: { status: 'READY' } },
            },
          },
        },
        orderBy: { score: 'desc' },
      },
    },
  });

  if (!report) {
    notFound();
  }

  const currentUser = await getSessionUser();
  const isOwner = currentUser ? report.ownerId === currentUser.id : false;
  const isLost = report.type === 'LOST';

  // Format matches
  const rawMatches = isLost ? report.lostMatches : report.foundMatches;
  const candidateMatches: MatchCandidate[] = rawMatches.map((m) => {
    const opp = isLost ? (m as any).foundReport : (m as any).lostReport;
    return {
      id: m.id,
      score: m.score,
      reasons: Array.isArray(m.reasons) ? (m.reasons as string[]) : [],
      report: {
        id: opp.id,
        type: opp.type,
        title: opp.title,
        description: opp.description,
        category: opp.category,
        brand: opp.brand,
        color: opp.color,
        locationLabel: opp.locationLabel,
        createdAt: opp.createdAt.toISOString(),
        images: opp.images.map((img: any) => ({
          id: img.id,
          url: `/api/v1/images/${img.id}`,
        })),
      },
    };
  });

  const activeClaims = report.claims.filter((c) => c.status === 'PENDING' || c.status === 'APPROVED');
  const userClaim = currentUser ? report.claims.find((c) => c.claimantId === currentUser.id) : null;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div>
        <Link
          href={`/${orgSlug}/reports`}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
        >
          ← Back to Discovery Feed
        </Link>
      </div>

      {/* Item Resolved Banner */}
      {report.status === 'RESOLVED' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3 text-emerald-900 shadow-xs">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
            ✓
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-emerald-950">
              Item Returned to Owner
            </h3>
            <p className="text-xs text-emerald-700">
              This listing has been resolved and removed from the active campus feed.
            </p>
          </div>
        </div>
      )}

      {/* Split-Pane Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (60%): Public Item Dossier */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
            {/* Gallery / Image Area */}
            <div className="relative aspect-16/10 bg-slate-100 flex items-center justify-center border-b border-slate-100 overflow-hidden">
              {report.images.length > 0 && report.images[0].status === 'READY' ? (
                <img
                  src={`/api/v1/images/${report.images[0].id}`}
                  alt={report.title}
                  className="w-full h-full object-cover"
                />
              ) : report.images.length > 0 && report.images[0].status === 'PROCESSING' ? (
                <div className="flex flex-col items-center justify-center bg-slate-900 text-white p-8 text-center w-full h-full">
                  <LockIcon className="w-8 h-8 text-indigo-400 mb-2 animate-bounce" />
                  <span className="text-sm font-bold">🔒 Sanitizing EXIF & GPS Metadata</span>
                  <span className="text-xs text-slate-400 mt-1 max-w-xs">
                    Converting raw upload to privacy-safe WebP thumbnail
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400">
                  <span className="text-5xl mb-2">
                    {report.category === 'Electronics' ? '💻' : report.category === 'Bags' ? '🎒' : '📦'}
                  </span>
                  <span className="text-xs font-semibold text-slate-400">
                    No photo uploaded for this item
                  </span>
                </div>
              )}

              {/* Status pill */}
              <div className="absolute top-4 left-4 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase shadow-xs ${
                    isLost
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isLost ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'
                    }`}
                  />
                  {report.type}
                </span>

                <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-slate-900/80 text-white backdrop-blur-xs">
                  {report.status}
                </span>
              </div>
            </div>

            {/* Privacy Verification Banner */}
            <div className="px-6 py-2.5 bg-slate-900 text-white flex items-center justify-between text-[11px] font-medium">
              <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <ShieldIcon className="w-3.5 h-3.5" />
                Privacy Verified • EXIF GPS Stripped
              </span>
              <span className="text-slate-400">Owner Identity Redacted</span>
            </div>

            {/* Body & Metadata */}
            <div className="p-6 sm:p-8 space-y-6">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                  {report.title}
                </h1>
                <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <MapPinIcon className="w-3.5 h-3.5 text-slate-400" />
                    <strong className="text-slate-700">{report.locationLabel}</strong>
                  </span>
                  <span>•</span>
                  <span>Reported {new Date(report.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Description
                </h4>
                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  {report.description}
                </p>
              </div>

              {/* Attributes Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">
                    Category
                  </span>
                  <span className="text-xs font-bold text-slate-800">{report.category}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">
                    Brand
                  </span>
                  <span className="text-xs font-bold text-slate-800">
                    {report.brand || 'Unspecified'}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">
                    Color
                  </span>
                  <span className="text-xs font-bold text-slate-800">
                    {report.color || 'Unspecified'}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">
                    Lock Version
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    v{report.version}
                  </span>
                </div>
              </div>

              {/* Actions component for Withdraw and Flag */}
              <ReportDetailActions
                reportId={report.id}
                orgSlug={orgSlug}
                isOwner={isOwner}
                reportStatus={report.status}
              />
            </div>
          </div>
        </div>

        {/* Right Column (40%): Role-Adaptive Workspace */}
        <div className="lg:col-span-5 space-y-6">
          {isOwner ? (
            /* OWNER WORKSPACE: Candidate Matches & Claims */
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <SparklesIcon className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Candidate Matches ({candidateMatches.length})
                  </h3>
                </div>
                <Link
                  href={`/${orgSlug}/claims`}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  View Claims ({activeClaims.length}) →
                </Link>
              </div>

              {candidateMatches.length === 0 ? (
                <div className="p-8 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                  <span className="text-2xl mb-1 block">⚡</span>
                  <h4 className="text-xs font-bold text-slate-800">
                    No High-Confidence Matches Yet
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    The background worker calculates matches above 35% similarity whenever new opposite-type reports are filed.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {candidateMatches.map((m) => (
                    <MatchCandidateCard key={m.id} match={m} orgSlug={orgSlug} />
                  ))}
                </div>
              )}
            </div>
          ) : report.status === 'RESOLVED' ? (
            /* RESOLVED STATE BANNER */
            <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 text-emerald-900 space-y-3 shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                  ✓
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-emerald-950">
                    Item Returned to Owner
                  </h3>
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    This listing has been resolved and removed from the active feed.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* NON-OWNER WORKSPACE: Claim Submission CTA */
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-6 space-y-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">
                  🛡️
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {isLost ? 'Found This Item? Notify the Owner' : 'Is This Your Lost Item? Submit a Claim'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {isLost
                      ? 'Submit details about where you found this item to connect with the owner.'
                      : 'Submit private verification proof to begin recovery.'}
                  </p>
                </div>
              </div>

              {userClaim ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">Your Claim Status:</span>
                    <span className="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] bg-emerald-600 text-white">
                      {userClaim.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-700">
                    You have submitted a claim. Visit your claims inbox to coordinate handoff if approved.
                  </p>
                  <Link
                    href={`/${orgSlug}/claims`}
                    className="inline-block mt-2 font-bold text-emerald-800 underline hover:text-emerald-900"
                  >
                    Open Claims Inbox →
                  </Link>
                </div>
              ) : (
                <ReportDetailActions
                  reportId={report.id}
                  orgSlug={orgSlug}
                  isOwner={false}
                  reportStatus={report.status}
                  reportType={report.type}
                  showClaimForm={true}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
