'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldIcon, SearchIcon, PlusIcon, MessageSquareIcon } from '../ui/icons';

interface TopNavbarProps {
  orgSlug: string;
  currentUser?: {
    displayName: string;
    email: string;
    role: string;
  };
}

export function TopNavbar({ orgSlug, currentUser }: TopNavbarProps) {
  const pathname = usePathname();
  const isModerator = currentUser?.role === 'MODERATOR' || currentUser?.role === 'ORG_ADMIN';

  const navLinks = [
    {
      name: 'Discovery Feed',
      href: `/${orgSlug}/reports`,
      icon: SearchIcon,
      active: pathname === `/${orgSlug}/reports`,
    },
    {
      name: 'Post Item',
      href: `/${orgSlug}/reports/new`,
      icon: PlusIcon,
      active: pathname === `/${orgSlug}/reports/new`,
    },
    {
      name: 'Claims Inbox',
      href: `/${orgSlug}/claims`,
      icon: MessageSquareIcon,
      active: pathname.startsWith(`/${orgSlug}/claims`),
    },
    ...(isModerator
      ? [
          {
            name: 'Moderator Console',
            href: `/${orgSlug}/moderation`,
            icon: ShieldIcon,
            active: pathname.startsWith(`/${orgSlug}/moderation`),
          },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-15 flex items-center justify-between">
        {/* Left: CMRIT Brand */}
        <div className="flex items-center gap-6">
          <Link href={`/${orgSlug}/reports`} className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-indigo-700 text-white flex items-center justify-center font-black text-sm shadow-xs group-hover:bg-indigo-600 transition">
              C
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-bold text-slate-900 tracking-tight text-sm">
                  CMRIT Lost & Found
                </span>
                <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200/60">
                  Campus
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-medium block mt-0.5">
                CMR Institute of Technology
              </span>
            </div>
          </Link>

          {/* Navigation links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    link.active
                      ? 'bg-slate-100 text-slate-900 font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{link.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Active User Pill */}
        <div className="flex items-center gap-3">
          {currentUser ? (
            <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
              <div className="w-7 h-7 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold shadow-xs">
                {currentUser.displayName.charAt(0)}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-xs font-semibold text-slate-800 leading-tight">
                  {currentUser.displayName}
                </span>
                <span className="text-[10px] text-slate-400">
                  {currentUser.role === 'MODERATOR' ? (
                    <span className="text-indigo-600 font-semibold">Campus Moderator</span>
                  ) : (
                    <span>Student / Member</span>
                  )}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">Connecting...</div>
          )}
        </div>
      </div>
    </header>
  );
}
