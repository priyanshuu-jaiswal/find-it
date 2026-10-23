'use client';

import React, { useState } from 'react';
import { HandoffStepper } from './handoff-stepper';
import { HandoffChatPanel } from './handoff-chat-panel';
import { ShieldIcon, LockIcon, CheckCircleIcon, XIcon, ClockIcon } from '../ui/icons';

export interface ClaimItem {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'HANDOFF_CONFIRMED';
  proofText?: string | null;
  decisionNote?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  report: {
    id: string;
    type: 'LOST' | 'FOUND';
    title: string;
    category: string;
    locationLabel: string;
    status: string;
  };
  claimant: {
    id: string;
    displayName: string;
    email: string;
  };
  isOwnerOfReport: boolean;
  isClaimant: boolean;
}

interface ClaimsInboxWorkspaceProps {
  initialIncoming: ClaimItem[];
  initialOutgoing: ClaimItem[];
  currentUserId: string;
  orgSlug: string;
}

export function ClaimsInboxWorkspace({
  initialIncoming,
  initialOutgoing,
  currentUserId,
  orgSlug,
}: ClaimsInboxWorkspaceProps) {
  const [box, setBox] = useState<'incoming' | 'outgoing'>('incoming');
  const [incomingClaims, setIncomingClaims] = useState(initialIncoming);
  const [outgoingClaims, setOutgoingClaims] = useState(initialOutgoing);
  const [selectedId, setSelectedId] = useState<string | null>(
    (initialIncoming[0] || initialOutgoing[0])?.id || null
  );

  const [decisionNote, setDecisionNote] = useState('');
  const [isDeciding, setIsDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const activeList = box === 'incoming' ? incomingClaims : outgoingClaims;
  const selectedClaim = activeList.find((c) => c.id === selectedId) || activeList[0] || null;

  const handleDecision = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!selectedClaim) return;
    setIsDeciding(true);
    setDecisionError(null);

    try {
      const res = await fetch(`/api/v1/claims/${selectedClaim.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          decisionNote: decisionNote || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to record decision');
      }

      // Update state
      const updated = json.data;
      setIncomingClaims((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, status: updated.status, decisionNote: updated.decisionNote } : c))
      );
      setDecisionNote('');
    } catch (err: any) {
      setDecisionError(err.message || 'Error executing claim decision');
    } finally {
      setIsDeciding(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Sidebar (35%): Master List */}
      <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col h-[380px] sm:h-[480px] lg:h-[700px]">
        {/* Toggle between Incoming & Outgoing */}
        <div className="p-3 border-b border-slate-100 bg-slate-50/80">
          <div className="grid grid-cols-2 p-1 bg-slate-200/70 rounded-xl text-xs font-bold text-slate-600">
            <button
              onClick={() => {
                setBox('incoming');
                if (incomingClaims[0]) setSelectedId(incomingClaims[0].id);
              }}
              className={`py-2 rounded-lg transition ${
                box === 'incoming'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              Incoming Claims ({incomingClaims.length})
            </button>
            <button
              onClick={() => {
                setBox('outgoing');
                if (outgoingClaims[0]) setSelectedId(outgoingClaims[0].id);
              }}
              className={`py-2 rounded-lg transition ${
                box === 'outgoing'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              Outgoing Claims ({outgoingClaims.length})
            </button>
          </div>
        </div>

        {/* Claims List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {activeList.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <span className="text-3xl mb-2">📬</span>
              <span className="text-xs font-semibold text-slate-700">No {box} claims yet</span>
              <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                {box === 'incoming'
                  ? 'When members submit ownership proof on items you posted, they will appear here.'
                  : 'Claims you submit on other items will appear here for tracking.'}
              </p>
            </div>
          ) : (
            activeList.map((claim) => {
              const isSelected = claim.id === selectedClaim?.id;
              return (
                <div
                  key={claim.id}
                  onClick={() => setSelectedId(claim.id)}
                  className={`p-4 cursor-pointer transition flex flex-col justify-between ${
                    isSelected
                      ? 'bg-indigo-50/50 border-l-4 border-l-indigo-600'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 line-clamp-1">
                      {claim.report.title}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
                        claim.status === 'APPROVED'
                          ? 'bg-indigo-100 text-indigo-700'
                          : claim.status === 'HANDOFF_CONFIRMED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : claim.status === 'PENDING'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {claim.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                    <span>
                      {box === 'incoming'
                        ? `Claimant: ${claim.claimant.displayName}`
                        : `Item: ${claim.report.category}`}
                    </span>
                    <span>{new Date(claim.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Workspace (65%): Detail, Review, & Chat */}
      <div className="lg:col-span-7 space-y-6">
        {selectedClaim ? (
          <>
            {/* 1. Handoff Stepper */}
            <HandoffStepper status={selectedClaim.status} />

            {/* 2. Private Ownership Proof Vault */}
            <div className="bg-slate-900 text-white rounded-3xl p-6 border border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                  <ShieldIcon className="w-4 h-4" />
                  <span>Private Verification Proof Vault</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  Redacted from Public Endpoints
                </span>
              </div>

              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                  Submitted Proof Text:
                </span>
                <p className="text-xs sm:text-sm text-slate-200 bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 leading-relaxed whitespace-pre-line">
                  {selectedClaim.proofText || (
                    <em className="text-slate-400">
                      Proof text is private to report owner and claimant.
                    </em>
                  )}
                </p>
              </div>

              {/* Owner Action Controls if PENDING */}
              {selectedClaim.isOwnerOfReport && selectedClaim.status === 'PENDING' && (
                <div className="pt-3 border-t border-slate-800 space-y-3">
                  <div className="text-[11px] text-indigo-300 flex items-center gap-1.5">
                    <LockIcon className="w-3.5 h-3.5" />
                    <span>
                      Approving locks the report and unlocks the gated handoff chat.
                    </span>
                  </div>

                  <div>
                    <input
                      type="text"
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      placeholder="Optional decision note for claimant..."
                      className="w-full text-xs px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                  </div>

                  {decisionError && (
                    <div className="p-2 bg-rose-900/60 border border-rose-700 text-rose-300 text-xs rounded-xl">
                      {decisionError}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                    <button
                      onClick={() => handleDecision('APPROVED')}
                      disabled={isDeciding}
                      className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <CheckCircleIcon className="w-4 h-4" />
                      <span>Approve Claim &amp; Unlock Chat</span>
                    </button>

                    <button
                      onClick={() => handleDecision('REJECTED')}
                      disabled={isDeciding}
                      className="py-2.5 px-4 bg-slate-800 hover:bg-rose-900/60 hover:text-rose-300 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition cursor-pointer"
                    >
                      Reject Claim
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Gated Handoff Chat Panel */}
            <HandoffChatPanel
              claimId={selectedClaim.id}
              status={selectedClaim.status}
              currentUserId={currentUserId}
              onHandoffConfirmed={() => {
                window.location.reload();
              }}
            />
          </>
        ) : (
          <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center text-slate-400">
            <span className="text-3xl mb-2 block">👈</span>
            <span className="text-xs font-semibold text-slate-700">
              Select a claim to review verification proof & coordinate pickup
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
