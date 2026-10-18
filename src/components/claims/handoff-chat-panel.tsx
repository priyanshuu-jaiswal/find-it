'use client';

import React, { useState, useEffect, useRef } from 'react';
import { LockIcon, MessageSquareIcon, CheckCircleIcon, RefreshCwIcon, ArrowRightIcon } from '../ui/icons';

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

interface HandoffChatPanelProps {
  claimId: string;
  status: string;
  currentUserId?: string;
  onHandoffConfirmed?: () => void;
}

export function HandoffChatPanel({
  claimId,
  status,
  currentUserId,
  onHandoffConfirmed,
}: HandoffChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmNote, setConfirmNote] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isApproved = status === 'APPROVED';
  const isConfirmed = status === 'HANDOFF_CONFIRMED';

  const fetchMessages = async () => {
    if (!isApproved && !isConfirmed) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/claims/${claimId}/messages`);
      const json = await res.json();
      if (res.ok && json.data) {
        setMessages(json.data);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [claimId, status]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;

    setIsSending(true);
    try {
      const res = await fetch(`/api/v1/claims/${claimId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newMessage.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.data) {
        setMessages((prev) => [...prev, json.data]);
        setNewMessage('');
      }
    } catch {
      // Ignore
    } finally {
      setIsSending(false);
    }
  };

  const handleConfirmHandoff = async () => {
    setIsConfirming(true);
    try {
      const res = await fetch(`/api/v1/claims/${claimId}/confirm-handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: confirmNote || 'Physical handoff verified on campus' }),
      });
      if (res.ok) {
        setShowConfirmModal(false);
        if (onHandoffConfirmed) onHandoffConfirmed();
      }
    } catch {
      // Ignore
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col h-[520px] overflow-hidden relative">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
        <div className="flex items-center gap-2">
          <MessageSquareIcon className="w-4 h-4 text-indigo-600" />
          <span className="text-xs font-bold text-slate-800">
            Handoff Coordination Chat
          </span>
        </div>
        {isApproved && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Active Coordination
          </span>
        )}
      </div>

      {/* Atomic Confirmation Banner (when APPROVED) */}
      {isApproved && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 p-3 px-4 flex items-center justify-between">
          <div className="text-xs">
            <span className="font-bold text-emerald-900 block">Met on campus?</span>
            <span className="text-[11px] text-emerald-700">
              Confirming returns the item, resolves the report, and closes competing claims.
            </span>
          </div>
          <button
            onClick={() => setShowConfirmModal(true)}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer shrink-0"
          >
            🤝 Confirm Handoff
          </button>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 relative">
        {/* Frosted Glass Overlay if NOT approved or confirmed */}
        {!isApproved && !isConfirmed && (
          <div className="absolute inset-0 bg-white/75 backdrop-blur-md z-10 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 mb-3">
              <LockIcon className="w-6 h-6 text-indigo-500" />
            </div>
            <h4 className="text-sm font-bold text-slate-800">
              Gated Handoff Messaging Locked
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mt-1 leading-relaxed">
              In-app messaging stays securely locked behind a privacy shield until the report owner reviews your proof and approves the claim.
            </p>
          </div>
        )}

        {messages.length === 0 && (isApproved || isConfirmed) ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs">
            <span className="text-xl mb-1">💬</span>
            <span>No messages yet. Send a note to coordinate a safe campus meeting point!</span>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.senderId === currentUserId;
            return (
              <div
                key={m.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400">
                  <span className="font-semibold text-slate-600">{m.senderName}</span>
                  <span>•</span>
                  <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div
                  className={`p-3 rounded-2xl text-xs max-w-[80%] leading-relaxed ${
                    isMe
                      ? 'bg-indigo-600 text-white rounded-tr-xs'
                      : 'bg-slate-100 text-slate-800 rounded-tl-xs'
                  }`}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input box */}
      {isApproved && (
        <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-100 bg-white flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Suggest a safe pickup spot (e.g., Campus Safety desk at 3 PM)..."
            className="flex-1 px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          <button
            type="submit"
            disabled={isSending || !newMessage.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition cursor-pointer"
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </form>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircleIcon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Confirm Physical Item Exchange
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  This executes an atomic transaction resolving the report.
                </p>
              </div>
            </div>

            <div className="text-xs text-slate-600 space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200/60">
              <div className="flex items-center gap-2 text-slate-800 font-medium">
                <span>✓</span> This claim transitions to <strong className="text-emerald-700 font-bold">HANDOFF_CONFIRMED</strong>
              </div>
              <div className="flex items-center gap-2 text-slate-800 font-medium">
                <span>✓</span> Parent report is closed as <strong className="text-emerald-700 font-bold">RESOLVED</strong>
              </div>
              <div className="flex items-center gap-2 text-slate-800 font-medium">
                <span>✓</span> Any other pending claims are automatically rejected
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Optional Verification Note:
              </label>
              <input
                type="text"
                value={confirmNote}
                onChange={(e) => setConfirmNote(e.target.value)}
                placeholder="e.g. Verified PIN and serial number at safety office"
                className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmHandoff}
                disabled={isConfirming}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
              >
                {isConfirming ? 'Confirming...' : 'Yes, Confirm Handoff'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
