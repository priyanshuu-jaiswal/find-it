'use client';

import React, { useState } from 'react';
import { ShieldIcon, FlagIcon, EyeIcon, EyeOffIcon, CheckCircleIcon, RefreshCwIcon, ClockIcon } from '../ui/icons';

export interface FlaggedReportItem {
  id: string;
  type: string;
  status: string;
  category: string;
  title: string;
  description: string;
  locationLabel: string;
  createdAt: string;
  flagsCount: number;
  flags: Array<{
    id: string;
    reason: string;
    createdAt: string;
  }>;
}

export interface AuditEventItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  details: any;
  createdAt: string;
}

interface ModeratorConsoleProps {
  initialReports: FlaggedReportItem[];
  initialAuditEvents: AuditEventItem[];
  orgId: string;
  orgSlug: string;
}

export function ModeratorConsole({
  initialReports,
  initialAuditEvents,
  orgId,
  orgSlug,
}: ModeratorConsoleProps) {
  const [reports, setReports] = useState(initialReports);
  const [auditEvents, setAuditEvents] = useState(initialAuditEvents);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(
    initialReports[0]?.id || null
  );
  const [actionNote, setActionNote] = useState('');
  const [isActing, setIsActing] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const selectedReport = reports.find((r) => r.id === selectedReportId) || reports[0] || null;

  const handleAction = async (action: 'HIDE' | 'RESTORE' | 'DISMISS_FLAGS') => {
    if (!selectedReport) return;
    if (!actionNote.trim()) {
      alert('A moderation note is required for the immutable audit log.');
      return;
    }

    setIsActing(true);
    setActionMessage(null);

    try {
      const res = await fetch(`/api/v1/moderation/reports/${selectedReport.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          note: actionNote.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Moderation action failed');
      }

      setActionMessage(`✓ Action ${action} successfully executed and recorded to audit log.`);
      setActionNote('');

      // Refresh page after short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err: any) {
      setActionMessage(`Error: ${err.message}`);
    } finally {
      setIsActing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <ShieldIcon className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Campus Safety Moderator Console
            </h1>
            <p className="text-xs text-slate-500">
              Review flagged listings, take scoped enforcement actions, and inspect the immutable audit log.
            </p>
          </div>
        </div>

        <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-full border border-indigo-200">
          CMRIT Campus Safety Office
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (50%): Flagged Reports Queue */}
        <div className="lg:col-span-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col h-[650px]">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">
              Open Flagged Listings Queue ({reports.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {reports.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <CheckCircleIcon className="w-8 h-8 text-emerald-500 mb-2" />
                <span className="text-xs font-bold text-slate-800">Moderation Queue is Clean</span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  No listings currently have open abuse flags.
                </span>
              </div>
            ) : (
              reports.map((r) => {
                const isSelected = r.id === selectedReport?.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedReportId(r.id)}
                    className={`p-4 cursor-pointer transition ${
                      isSelected
                        ? 'bg-indigo-50/60 border-l-4 border-l-indigo-600'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 line-clamp-1">
                        {r.title}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                        <FlagIcon className="w-3 h-3" />
                        {r.flagsCount} Open Flag{r.flagsCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 line-clamp-2 mt-1">
                      {r.description}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2">
                      <span>Status: {r.status}</span>
                      <span>Reported {new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column (50%): Triage Workspace & Audit Trail */}
        <div className="lg:col-span-6 space-y-6">
          {selectedReport ? (
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-6 space-y-5">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                    Selected Item
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                    {selectedReport.title}
                  </h3>
                  <span className="text-xs text-slate-500">{selectedReport.locationLabel}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">
                  {selectedReport.status}
                </span>
              </div>

              {/* Reporter Reasons */}
              <div>
                <span className="text-xs font-bold text-slate-800 block mb-2">
                  Flags Submitted by Members:
                </span>
                <div className="space-y-2">
                  {selectedReport.flags.map((flag) => (
                    <div
                      key={flag.id}
                      className="p-3 bg-rose-50/60 rounded-xl border border-rose-100 text-xs text-rose-900 leading-relaxed"
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-rose-600 font-semibold mb-1">
                        <FlagIcon className="w-3 h-3" />
                        <span>Submitted {new Date(flag.createdAt).toLocaleDateString()}</span>
                      </div>
                      &ldquo;{flag.reason}&rdquo;
                    </div>
                  ))}
                </div>
              </div>

              {/* Enforcement Action Form */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <label className="block text-xs font-bold text-slate-800">
                  Moderator Action Note * (Logged to immutable audit log)
                </label>
                <input
                  type="text"
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  placeholder="e.g. Inappropriate item containing hazardous material, removing from public feed."
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />

                {actionMessage && (
                  <div className="p-2.5 bg-slate-900 text-white rounded-xl text-xs font-medium">
                    {actionMessage}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    onClick={() => handleAction('HIDE')}
                    disabled={isActing}
                    className="py-2.5 px-3 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-1 shadow-xs"
                  >
                    <EyeOffIcon className="w-3.5 h-3.5" />
                    <span>Hide Report</span>
                  </button>

                  <button
                    onClick={() => handleAction('RESTORE')}
                    disabled={isActing}
                    className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-1 shadow-xs"
                  >
                    <EyeIcon className="w-3.5 h-3.5" />
                    <span>Restore</span>
                  </button>

                  <button
                    onClick={() => handleAction('DISMISS_FLAGS')}
                    disabled={isActing}
                    className="py-2.5 px-3 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-1 shadow-xs"
                  >
                    <CheckCircleIcon className="w-3.5 h-3.5" />
                    <span>Dismiss</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-3xl border border-slate-200">
              Select a flagged report to review reasons and take enforcement action.
            </div>
          )}

          {/* Immutable Audit Log Drawer */}
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-800">
                Immutable Audit Events Trail (Append-Only)
              </span>
              <span className="text-[10px] text-slate-400 font-mono">audit_events</span>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto">
              {auditEvents.length === 0 ? (
                <span className="text-xs text-slate-400 block text-center py-4">
                  No moderation actions recorded yet.
                </span>
              ) : (
                auditEvents.map((event) => (
                  <div
                    key={event.id}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-700">{event.action}</span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Entity: <span className="font-mono">{event.entityId.slice(0, 8)}...</span>
                    </div>
                    {event.details?.note && (
                      <div className="text-[11px] text-slate-500 italic">
                        Note: &ldquo;{event.details.note}&rdquo;
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
