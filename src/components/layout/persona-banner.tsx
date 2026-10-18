'use client';

import React, { useState, useEffect } from 'react';
import { UserIcon, ZapIcon, CheckIcon, RefreshCwIcon } from '../ui/icons';

const PERSONAS = [
  {
    name: 'Alice (Lost Owner)',
    email: 'alice@apex.edu',
    role: 'MEMBER',
  },
  {
    name: 'Bob (Claimant/Finder)',
    email: 'bob@apex.edu',
    role: 'MEMBER',
  },
  {
    name: 'Carol (Campus Moderator)',
    email: 'carol@apex.edu',
    role: 'MODERATOR',
  },
];

export function PersonaBanner() {
  const [activeEmail, setActiveEmail] = useState<string>('alice@apex.edu');
  const [isTicking, setIsTicking] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)findit-persona=([^;]+)/);
    if (match) {
      setActiveEmail(decodeURIComponent(match[1]));
    } else {
      document.cookie = 'findit-persona=alice@apex.edu; path=/; max-age=86400';
    }
  }, []);

  const handleSwitch = (email: string) => {
    document.cookie = `findit-persona=${encodeURIComponent(email)}; path=/; max-age=86400`;
    setActiveEmail(email);
    window.location.reload();
  };

  const handleTickWorker = async () => {
    setIsTicking(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/v1/internal/worker/tick', {
        method: 'POST',
        headers: { authorization: 'Bearer findit-worker-dev-secret' },
      });
      const data = await res.json();
      if (res.ok) {
        const count = data.data?.executedCount ?? 0;
        setFeedback(`Worker: ${count} job${count === 1 ? '' : 's'} done`);
        if (count > 0) {
          setTimeout(() => window.location.reload(), 1000);
        }
      } else {
        setFeedback('Worker error');
      }
    } catch {
      setFeedback('Failed to reach worker');
    } finally {
      setIsTicking(false);
      setTimeout(() => setFeedback(null), 3500);
    }
  };

  return (
    <div className="bg-slate-900 text-slate-300 text-[11px] py-1.5 px-4 border-b border-slate-800 flex items-center justify-between">
      <div className="max-w-7xl mx-auto w-full flex flex-wrap items-center justify-between gap-2">
        {/* Left: Persona Switcher Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-slate-400 mr-1 tracking-wider flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Persona:
          </span>

          {PERSONAS.map((p) => {
            const isSelected = p.email === activeEmail;
            return (
              <button
                key={p.email}
                onClick={() => handleSwitch(p.email)}
                className={`px-2.5 py-0.5 rounded-full font-medium transition cursor-pointer flex items-center gap-1 ${
                  isSelected
                    ? 'bg-indigo-600 text-white font-bold shadow-xs'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                {isSelected && <CheckIcon className="w-3 h-3 text-emerald-300" />}
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Worker Trigger */}
        <div className="flex items-center gap-2">
          {feedback && (
            <span className="text-emerald-400 font-semibold">{feedback}</span>
          )}
          <button
            onClick={handleTickWorker}
            disabled={isTicking}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-800 hover:bg-indigo-900/60 text-slate-200 hover:text-indigo-200 transition cursor-pointer text-[10px] font-semibold border border-slate-700"
          >
            {isTicking ? (
              <RefreshCwIcon className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <ZapIcon className="w-2.5 h-2.5 text-amber-400" />
            )}
            <span>⚡ Tick Worker</span>
          </button>
        </div>
      </div>
    </div>
  );
}
