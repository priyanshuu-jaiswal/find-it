'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlagIcon, ShieldIcon, CheckCircleIcon, AlertTriangleIcon } from '../ui/icons';

interface ReportDetailActionsProps {
  reportId: string;
  orgSlug: string;
  isOwner: boolean;
  reportStatus: string;
  showClaimForm?: boolean;
}

export function ReportDetailActions({
  reportId,
  orgSlug,
  isOwner,
  reportStatus,
  showClaimForm = false,
}: ReportDetailActionsProps) {
  const router = useRouter();

  // Withdraw state
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Flag state
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [isFlagging, setIsFlagging] = useState(false);
  const [flagSuccess, setFlagSuccess] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  // Claim state
  const [proofText, setProofText] = useState('');
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const handleWithdraw = async () => {
    if (!confirm('Are you sure you want to withdraw this report from campus listings?')) {
      return;
    }
    setIsWithdrawing(true);
    try {
      const res = await fetch(`/api/v1/reports/${reportId}/withdraw`, {
        method: 'POST',
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      // Ignore
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (flagReason.trim().length < 5) {
      setFlagError('Reason must be at least 5 characters.');
      return;
    }
    setIsFlagging(true);
    setFlagError(null);
    try {
      const res = await fetch(`/api/v1/reports/${reportId}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: flagReason.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setFlagSuccess(true);
        setTimeout(() => setShowFlagModal(false), 1500);
      } else {
        setFlagError(data.error?.message || 'Failed to submit flag');
      }
    } catch {
      setFlagError('Error submitting flag');
    } finally {
      setIsFlagging(false);
    }
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (proofText.trim().length < 10) {
      setClaimError('Proof description must be at least 10 characters.');
      return;
    }
    setIsClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch(`/api/v1/reports/${reportId}/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proofText: proofText.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setClaimSuccess(true);
        setTimeout(() => {
          router.push(`/${orgSlug}/claims`);
        }, 1200);
      } else {
        setClaimError(data.error?.message || 'Failed to submit claim');
      }
    } catch {
      setClaimError('Error submitting claim');
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Owner controls */}
      {isOwner && reportStatus === 'OPEN' && (
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
          <span className="text-slate-500">Need to cancel this listing?</span>
          <button
            onClick={handleWithdraw}
            disabled={isWithdrawing}
            className="px-3 py-1.5 rounded-lg font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100 transition cursor-pointer"
          >
            {isWithdrawing ? 'Withdrawing...' : 'Withdraw Report'}
          </button>
        </div>
      )}

      {/* Member controls: Flag button */}
      {!isOwner && !showClaimForm && (
        <div className="flex items-center justify-end pt-3 border-t border-slate-100">
          <button
            onClick={() => setShowFlagModal(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 transition cursor-pointer"
          >
            <FlagIcon className="w-3.5 h-3.5" />
            <span>Flag Suspicious / Inappropriate</span>
          </button>
        </div>
      )}

      {/* Non-Owner Claim Form */}
      {showClaimForm && (
        <div className="space-y-4">
          {claimSuccess ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircleIcon className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <strong className="block font-bold">Claim Submitted!</strong>
                <span>Redirecting to your claims inbox...</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleClaim} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Private Verification Proof * (10–1500 chars)
                </label>
                <textarea
                  rows={4}
                  required
                  value={proofText}
                  onChange={(e) => setProofText(e.target.value)}
                  placeholder="Describe secret or distinguishing details (e.g. lockscreen wallpaper, serial number, contents inside pouch, stickers)..."
                  className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 leading-relaxed"
                />
              </div>

              <div className="p-3 bg-slate-900 text-white rounded-xl text-[11px] flex items-start gap-2">
                <ShieldIcon className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-slate-300">
                  Your proof text is encrypted, excluded from public endpoints, and visible strictly to the report owner and campus safety moderators.
                </span>
              </div>

              {claimError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
                  {claimError}
                </div>
              )}

              <button
                type="submit"
                disabled={isClaiming || !proofText.trim()}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
              >
                {isClaiming ? 'Submitting Claim...' : 'Submit Ownership Claim'}
              </button>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setShowFlagModal(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-rose-600 transition"
                >
                  <FlagIcon className="w-3 h-3" />
                  <span>Flag this report</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Flag Report Modal */}
      {showFlagModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <FlagIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Flag Report for Review</h3>
                <p className="text-xs text-slate-500">
                  Reports with flags are triaged by campus moderators.
                </p>
              </div>
            </div>

            {flagSuccess ? (
              <div className="p-4 bg-emerald-50 text-emerald-800 text-xs font-medium rounded-xl flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
                <span>Flag submitted successfully. Thank you for keeping campus safe!</span>
              </div>
            ) : (
              <form onSubmit={handleFlag} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Reason for Flagging *
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={flagReason}
                    onChange={(e) => setFlagReason(e.target.value)}
                    placeholder="Describe why this listing is suspicious, abusive, or inaccurate..."
                    className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Rate limited to max 10 flags per minute.
                  </span>
                </div>

                {flagError && (
                  <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded-xl font-medium">
                    {flagError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowFlagModal(false)}
                    className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isFlagging}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition cursor-pointer"
                  >
                    {isFlagging ? 'Submitting...' : 'Submit Flag'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
