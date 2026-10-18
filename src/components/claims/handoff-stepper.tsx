'use client';

import React from 'react';
import { CheckIcon, LockIcon, ClockIcon } from '../ui/icons';

interface HandoffStepperProps {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'HANDOFF_CONFIRMED';
}

export function HandoffStepper({ status }: HandoffStepperProps) {
  const isRejected = status === 'REJECTED' || status === 'WITHDRAWN';

  const steps = [
    {
      id: 1,
      name: 'Proof Submitted',
      description: 'Private verification text',
      isCurrent: status === 'PENDING',
      isCompleted: status === 'APPROVED' || status === 'HANDOFF_CONFIRMED',
    },
    {
      id: 2,
      name: 'Claim Approved',
      description: 'Gated handoff chat unlocked',
      isCurrent: status === 'APPROVED',
      isCompleted: status === 'HANDOFF_CONFIRMED',
    },
    {
      id: 3,
      name: 'Handoff Confirmed',
      description: 'Item returned & report resolved',
      isCurrent: status === 'HANDOFF_CONFIRMED',
      isCompleted: status === 'HANDOFF_CONFIRMED',
    },
  ];

  if (isRejected) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800 flex items-center justify-between">
        <span className="font-semibold">Claim Status: {status}</span>
        <span className="text-[11px] text-rose-600">This claim was not approved or was withdrawn.</span>
      </div>
    );
  }

  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
      <div className="grid grid-cols-3 gap-2">
        {steps.map((step, idx) => {
          return (
            <div key={step.id} className="flex flex-col relative">
              <div className="flex items-center gap-2 mb-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                    step.isCompleted
                      ? 'bg-emerald-500 text-white'
                      : step.isCurrent
                      ? 'bg-indigo-600 text-white ring-4 ring-indigo-50'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {step.isCompleted ? (
                    <CheckIcon className="w-3.5 h-3.5" />
                  ) : (
                    <span>{step.id}</span>
                  )}
                </div>
                <span
                  className={`text-xs font-bold truncate ${
                    step.isCurrent
                      ? 'text-indigo-600'
                      : step.isCompleted
                      ? 'text-slate-800'
                      : 'text-slate-400'
                  }`}
                >
                  {step.name}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 hidden sm:block">
                {step.description}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
