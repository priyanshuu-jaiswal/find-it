'use client';

import React, { useState, useEffect } from 'react';
import { UserIcon, ZapIcon, ShieldIcon, CheckIcon, RefreshCwIcon, ChevronRightIcon } from '../ui/icons';

interface Persona {
  id: string;
  name: string;
  email: string;
  role: 'MEMBER' | 'MODERATOR';
  description: string;
  badgeColor: string;
}

const PERSONAS: Persona[] = [
  {
    id: 'alice',
    name: 'Alice Chen',
    email: 'alice@apex.edu',
    role: 'MEMBER',
    description: 'Lost Item Owner / Claimant',
    badgeColor: 'bg-rose-100 text-rose-700 border-rose-200',
  },
  {
    id: 'bob',
    name: 'Bob Smith',
    email: 'bob@apex.edu',
    role: 'MEMBER',
    description: 'Finder / Claimant',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  {
    id: 'carol',
    name: 'Carol Davis',
    email: 'carol@apex.edu',
    role: 'MODERATOR',
    description: 'Campus Safety Moderator',
    badgeColor: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  },
];

export function PersonaSwitcherDock() {
  const [activeEmail, setActiveEmail] = useState<string>('alice@apex.edu');
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [isTicking, setIsTicking] = useState<boolean>(false);
  const [tickFeedback, setTickFeedback] = useState<string | null>(null);

  useEffect(() => {
    // Read current persona cookie if present
    const match = document.cookie.match(/(?:^|;\s*)findit-persona=([^;]+)/);
    if (match) {
      setActiveEmail(decodeURIComponent(match[1]));
    } else {
      // Default to Alice
      document.cookie = 'findit-persona=alice@apex.edu; path=/; max-age=86400';
    }
  }, []);

  const handleSwitchPersona = (email: string) => {
    document.cookie = `findit-persona=${encodeURIComponent(email)}; path=/; max-age=86400`;
    setActiveEmail(email);
    window.location.reload();
  };

  const handleTickWorker = async () => {
    setIsTicking(true);
    setTickFeedback(null);
    try {
      const res = await fetch('/api/v1/internal/worker/tick', {
        method: 'POST',
        headers: {
          authorization: 'Bearer findit-worker-dev-secret',
        },
      });
      const data = await res.json();
      if (res.ok) {
        const count = data.data?.executedCount ?? 0;
        setTickFeedback(`✓ Ran worker: ${count} job${count === 1 ? '' : 's'} processed`);
        // Refresh after short delay if jobs were run
        if (count > 0) {
          setTimeout(() => window.location.reload(), 1200);
        }
      } else {
        setTickFeedback(`Failed: ${data.error?.message || 'Error'}`);
      }
    } catch {
      setTickFeedback('Worker request error');
    } finally {
      setIsTicking(false);
      setTimeout(() => setTickFeedback(null), 4000);
    }
  };

  const currentPersona = PERSONAS.find((p) => p.email === activeEmail) || PERSONAS[0];

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
      {/* Expanded Control Dock */}
      {isExpanded && (
        <div className="bg-slate-900/95 backdrop-blur-md text-white p-4 rounded-2xl shadow-2xl border border-slate-700/80 w-80 mb-2 transition-all duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold tracking-wider uppercase text-slate-400">
                Dev Persona Dock
              </span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-slate-800"
            >
              Minimize
            </button>
          </div>

          {/* Persona selector list */}
          <div className="space-y-1.5 my-3">
            {PERSONAS.map((p) => {
              const isSelected = p.email === activeEmail;
              return (
                <button
                  key={p.id}
                  onClick={() => handleSwitchPersona(p.email)}
                  className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-center justify-between ${
                    isSelected
                      ? 'bg-slate-800 text-white font-medium shadow-inner border border-slate-700'
                      : 'hover:bg-slate-800/50 text-slate-300'
                  }`}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{p.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${p.badgeColor}`}>
                        {p.role}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 mt-0.5">{p.description}</span>
                  </div>
                  {isSelected && <CheckIcon className="w-4 h-4 text-emerald-400" />}
                </button>
              );
            })}
          </div>

          {/* Worker Tick Action */}
          <div className="pt-2 border-t border-slate-800">
            <button
              onClick={handleTickWorker}
              disabled={isTicking}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition shadow-sm cursor-pointer"
            >
              {isTicking ? (
                <>
                  <RefreshCwIcon className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing Async Jobs...</span>
                </>
              ) : (
                <>
                  <ZapIcon className="w-3.5 h-3.5 text-amber-300" />
                  <span>⚡ Tick Background Worker</span>
                </>
              )}
            </button>
            {tickFeedback && (
              <p className="text-[11px] text-center mt-2 text-indigo-300 font-medium">
                {tickFeedback}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Collapsed Pill Button */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-slate-900/90 hover:bg-slate-900 text-white text-xs font-semibold rounded-full shadow-lg border border-slate-700 backdrop-blur-md cursor-pointer transition"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>Active: {currentPersona.name}</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
            {currentPersona.role}
          </span>
        </button>
      )}
    </div>
  );
}
