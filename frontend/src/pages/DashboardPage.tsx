import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  Clock,
  LogOut,
  MessageSquare,
  Send,
  Unplug,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { AuthUser } from '../types';
import { API_BASE_URL, api } from '../api/client';
import { ComposeView } from '../features/compose/ComposeView';
import { EmailListView } from '../features/emails/EmailListView';
import { useToast } from '../hooks/useToast';

export interface DashboardPageProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

type DashboardTab = 'scheduled' | 'sent';

export const DashboardPage: React.FC<DashboardPageProps> = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('scheduled');
  const [composing, setComposing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const slackQuery = useQuery({
    queryKey: ['slack', 'status'],
    queryFn: api.getSlackStatus,
  });

  const scheduledCountQuery = useQuery({
    queryKey: ['emails', 'scheduled', 1, ''],
    queryFn: () => api.getScheduledEmails(1, 20),
    refetchInterval: 5000,
  });

  const sentCountQuery = useQuery({
    queryKey: ['emails', 'sent', 1, ''],
    queryFn: () => api.getSentEmails(1, 20),
    refetchInterval: 5000,
  });

  const disconnectMutation = useMutation({
    mutationFn: api.disconnectSlack,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['slack', 'status'] });
      showToast('info', 'Slack integration disconnected');
    },
  });

  useEffect(() => {
    const slackParam = searchParams.get('slack');
    if (slackParam === 'connected') {
      showToast('success', 'Slack connected! Rate-limit alerts are active.');
      searchParams.delete('slack');
      setSearchParams(searchParams, { replace: true });
    } else if (slackParam === 'error') {
      showToast('error', 'Failed to connect Slack. Please try again.');
      searchParams.delete('slack');
      searchParams.delete('reason');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, showToast]);

  if (composing) {
    return <ComposeView onBack={() => setComposing(false)} />;
  }

  const slackConnected = slackQuery.data?.connected;

  return (
    <div className="flex min-h-screen bg-white">
      {/* Left Sidebar (Figma Images 2 & 3) */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-100 bg-white px-4 py-5">
        <div className="mb-5 px-2">
          <span className="font-mono text-2xl font-black tracking-tighter text-slate-900">
            ONB
          </span>
        </div>

        {/* User Profile Pill */}
        <div className="relative mb-4">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-xl bg-slate-50 p-2.5 text-left transition-colors hover:bg-slate-100"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-900">{user.name}</p>
                <p className="truncate text-[11px] text-slate-400">{user.email}</p>
              </div>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          </button>

          {menuOpen && (
            <div className="absolute left-0 right-0 top-14 z-20 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
              <button
                type="button"
                onClick={() => void onLogout()}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </button>
            </div>
          )}
        </div>

        {/* Compose Outlined Green Pill */}
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="mb-6 w-full rounded-full border border-emerald-500 py-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-50"
        >
          Compose
        </button>

        {/* CORE Navigation */}
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          CORE
        </p>
        <nav className="space-y-1">
          <button
            type="button"
            onClick={() => setActiveTab('scheduled')}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              activeTab === 'scheduled'
                ? 'bg-[#EAF8EE] font-medium text-slate-900'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Clock className="h-4 w-4 text-slate-500" />
              Scheduled
            </span>
            <span className="text-xs text-slate-500">
              {scheduledCountQuery.data?.total ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sent')}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              activeTab === 'sent'
                ? 'bg-[#EAF8EE] font-medium text-slate-900'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Send className="h-4 w-4 text-slate-500" />
              Sent
            </span>
            <span className="text-xs text-slate-500">
              {sentCountQuery.data?.total ?? 0}
            </span>
          </button>
        </nav>

        {/* Slack Connection Footer */}
        <div className="mt-auto border-t border-slate-100 pt-4">
          {slackConnected ? (
            <div className="flex items-center justify-between rounded-lg bg-[#EAF8EE] px-3 py-2 text-xs font-medium text-emerald-800">
              <span className="flex items-center gap-1.5 truncate">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                {slackQuery.data?.teamName}
              </span>
              <button
                type="button"
                onClick={() => disconnectMutation.mutate()}
                title="Disconnect Slack"
                className="rounded p-1 hover:bg-emerald-200/50"
              >
                <Unplug className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                window.location.href = `${API_BASE_URL}/api/slack/connect`;
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Connect Slack
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <EmailListView mode={activeTab} onCompose={() => setComposing(true)} />
    </div>
  );
};
