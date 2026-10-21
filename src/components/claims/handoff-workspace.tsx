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

interface HandoffWorkspaceProps {
  initialIncoming: ClaimItem[];
  initialOutgoing: ClaimItem[];
  currentUserId: string;
  orgSlug: string;
}

export function HandoffWorkspace({
  initialIncoming,
  initialOutgoing,
  currentUserId,
  orgSlug,
}: HandoffWorkspaceProps) {
  const hasPendingIncoming = initialIncoming.some((c) => c.status === 'PENDING');
  const defaultBox = hasPendingIncoming || initialIncoming.length > 0 ? 'incoming' : initialOutgoing.length > 0 ? 'outgoing' : 'incoming';

  const [box, setBox] = useState<'incoming' | 'outgoing'>(defaultBox);
  const [incomingClaims, setIncomingClaims] = useState(initialIncoming);
  const [outgoingClaims, setOutgoingClaims] = useState(initialOutgoing);

  const initialList = defaultBox === 'incoming' ? initialIncoming : initialOutgoing;
  const [selectedId, setSelectedId] = useState<string | null>(
    (initialList[0] || initialIncoming[0] || initialOutgoing[0])?.id || null
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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Left Column (4 cols): Claim Master List */}
      <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col h-[650px]">
        {/* Toggle between Incoming & Outgoing */}
        <div className="p-3 border-b border-slate-100 bg-slate-50">
          <div className="grid grid-cols-2 p-1 bg-slate-200/70 rounded-xl text-xs font-bold text-slate-600">
            <button
              onClick={() => {
                setBox('incoming');
                if (incomingClaims[0]) setSelectedId(incomingClaims[0].id);
              }}
              className={`py-1.5 px-2 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                box === 'incoming'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              <span>Incoming Claims ({incomingClaims.length})</span>
              {incomingClaims.filter((c) => c.status === 'PENDING').length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-rose-500 text-white animate-pulse">
                  {incomingClaims.filter((c) => c.status === 'PENDING').length}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setBox('outgoing');
                if (outgoingClaims[0]) setSelectedId(outgoingClaims[0].id);
              }}
              className={`py-1.5 px-2 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                box === 'outgoing'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'hover:text-slate-900'
              }`}
            >
              <span>Outgoing Claims ({outgoingClaims.length})</span>
            </button>
          </div>
        </div>

        {/* Claim list */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {activeList.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400">
              <span className="text-2xl mb-1">📬</span>
              <span className="text-xs font-semibold text-slate-700">No {box} claims</span>
              <p className="text-[11px] text-slate-400 mt-0.5 max-w-xs">
                {box === 'incoming'
                  ? 'Claims submitted on items you reported appear here.'
                  : 'Claims you submitted on other items appear here.'}
              </p>
            </div>
          ) : (
            activeList.map((claim) => {
              const isSelected = claim.id === selectedClaim?.id;
              return (
                <div
                  key={claim.id}
                  onClick={() => setSelectedId(claim.id)}
                  className={`p-3.5 cursor-pointer transition ${
                    isSelected
                      ? 'bg-indigo-50/60 border-l-4 border-l-indigo-600'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 line-clamp-1">
                      {claim.report.title}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
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

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5">
                    <span className="truncate">
                      {box === 'incoming'
                        ? `By ${claim.claimant.displayName}`
                        : `Zone: ${claim.report.locationLabel}`}
                    </span>
                    <span className="shrink-0">{new Date(claim.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column (7 cols): Proof Review, Approval, & Chat */}
      <div className="lg:col-span-7 space-y-4">
        {selectedClaim ? (
          <>
            <HandoffStepper status={selectedClaim.status} />

            {/* Proof Vault */}
            <div className="bg-slate-900 text-white rounded-2xl p-5 border border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <ShieldIcon className="w-3.5 h-3.5" />
                  Private Verification Proof
                </span>
                <span className="text-[10px] text-slate-400">
                  {selectedClaim.isOwnerOfReport ? 'Visible to you as owner' : 'Your private proof'}
                </span>
              </div>

              <p className="text-xs text-slate-200 bg-slate-800/80 p-3 rounded-xl border border-slate-700/80 leading-relaxed whitespace-pre-line">
                {selectedClaim.proofText || 'Proof text is private to report owner and claimant.'}
              </p>

              {/* Approval controls for owner if PENDING */}
              {selectedClaim.isOwnerOfReport && selectedClaim.status === 'PENDING' && (
                <div className="pt-2 border-t border-slate-800 space-y-2.5">
                  <input
                    type="text"
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Optional note for claimant..."
                    className="w-full text-xs px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />

                  {decisionError && (
                    <div className="p-2 bg-rose-900/60 border border-rose-700 text-rose-300 text-xs rounded-xl">
                      {decisionError}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDecision('APPROVED')}
                      disabled={isDeciding}
                      className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-1 shadow-xs"
                    >
                      <CheckCircleIcon className="w-3.5 h-3.5" />
                      <span>Approve Claim & Unlock Chat</span>
                    </button>

                    <button
                      onClick={() => handleDecision('REJECTED')}
                      disabled={isDeciding}
                      className="py-2 px-3 bg-slate-800 hover:bg-rose-900/60 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition cursor-pointer"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Panel */}
            <HandoffChatPanel
              claimId={selectedClaim.id}
              status={selectedClaim.status}
              currentUserId={currentUserId}
              onHandoffConfirmed={() => window.location.reload()}
            />
          </>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            Select a claim to review verification proof and coordinate pickup.
          </div>
        )}
      </div>
    </div>
  );
}
