'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ThumbsUpIcon, ThumbsDownIcon, SparklesIcon, CheckCircleIcon, MapPinIcon } from '../ui/icons';

export interface MatchCandidate {
  id: string;
  score: number;
  reasons: string[];
  report: {
    id: string;
    type: 'LOST' | 'FOUND';
    title: string;
    description: string;
    category: string;
    brand?: string | null;
    color?: string | null;
    locationLabel: string;
    createdAt: string;
    images?: Array<{ id: string; url?: string }>;
  };
}

interface MatchCandidateCardProps {
  match: MatchCandidate;
  orgSlug: string;
  onDismiss?: (matchId: string) => void;
}

export function MatchCandidateCard({ match, orgSlug, onDismiss }: MatchCandidateCardProps) {
  const [feedback, setFeedback] = useState<'useful' | 'dismissed' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const scorePercent = Math.round(match.score * 100);

  const handleFeedback = async (useful: boolean) => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/matches/${match.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useful, dismissed: !useful }),
      });
      if (res.ok) {
        setFeedback(useful ? 'useful' : 'dismissed');
        if (!useful && onDismiss) {
          setTimeout(() => onDismiss(match.id), 400);
        }
      }
    } catch {
      // Ignore
    } finally {
      setIsSubmitting(false);
    }
  };

  if (feedback === 'dismissed') {
    return null;
  }

  const firstImage = match.report.images && match.report.images.length > 0 ? match.report.images[0] : null;

  return (
    <div className="bg-white rounded-2xl border border-indigo-100/90 shadow-xs hover:shadow-md transition overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          {/* Left: Thumbnail & Title */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {firstImage?.url ? (
              <img
                src={firstImage.url}
                alt={match.report.title}
                className="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xl shrink-0">
                📦
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    match.report.type === 'LOST'
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  {match.report.type}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {match.report.locationLabel}
                </span>
              </div>

              <Link
                href={`/${orgSlug}/reports/${match.report.id}`}
                className="font-bold text-slate-900 text-sm hover:text-indigo-600 transition block mt-1 truncate"
              >
                {match.report.title}
              </Link>
              <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                {match.report.description}
              </p>
            </div>
          </div>

          {/* Right: Score Ring */}
          <div className="relative shrink-0 text-center">
            <button
              onClick={() => setShowBreakdown(!showBreakdown)}
              className="group flex flex-col items-center cursor-pointer"
            >
              <div className="w-12 h-12 rounded-full border-3 border-indigo-500 bg-indigo-50/80 flex items-center justify-center font-bold text-indigo-700 text-xs shadow-xs group-hover:scale-105 transition-transform">
                {scorePercent}%
              </div>
              <span className="text-[10px] font-semibold text-indigo-600 mt-1">Match</span>
            </button>
          </div>
        </div>

        {/* Breakdown Popover */}
        {showBreakdown && (
          <div className="mt-3 p-3 bg-slate-900 text-white rounded-xl text-xs space-y-1.5 transition-all">
            <span className="text-[11px] font-bold text-indigo-300 block uppercase tracking-wider">
              Deterministic Weights Breakdown
            </span>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
              <div>Category Match: Max 25%</div>
              <div>Text & Trigrams: Max 35%</div>
              <div>Brand & Color: Max 15%</div>
              <div>Location Proximity: Max 15%</div>
              <div>Temporal Decay: Max 10%</div>
            </div>
          </div>
        )}

        {/* Explainability Reason Chips */}
        {match.reasons && match.reasons.length > 0 && (
          <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
            {match.reasons.map((reason, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60"
              >
                <CheckCircleIcon className="w-3 h-3 text-indigo-600" />
                {reason}
              </span>
            ))}
          </div>
        )}

        {/* Action / Feedback row */}
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleFeedback(true)}
              disabled={isSubmitting || feedback === 'useful'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                feedback === 'useful'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <ThumbsUpIcon className="w-3 h-3" />
              <span>{feedback === 'useful' ? 'Marked Useful' : 'Useful Match'}</span>
            </button>

            <button
              onClick={() => handleFeedback(false)}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 transition cursor-pointer"
            >
              <ThumbsDownIcon className="w-3 h-3" />
              <span>Dismiss</span>
            </button>
          </div>

          <Link
            href={`/${orgSlug}/reports/${match.report.id}`}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
          >
            Compare Details →
          </Link>
        </div>
      </div>
    </div>
  );
}
