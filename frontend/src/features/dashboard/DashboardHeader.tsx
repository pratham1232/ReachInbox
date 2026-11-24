import React from 'react';
import { LogOut, MailCheck, MessageSquare, Unplug } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL, api } from '../../api/client';
import type { AuthUser } from '../../types';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../hooks/useToast';

export interface DashboardHeaderProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({ user, onLogout }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const slackQuery = useQuery({
    queryKey: ['slack', 'status'],
    queryFn: api.getSlackStatus,
  });

  const disconnectMutation = useMutation({
    mutationFn: api.disconnectSlack,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['slack', 'status'] });
      showToast('info', 'Slack integration disconnected');
    },
    onError: (err) => {
      showToast('error', err instanceof Error ? err.message : 'Failed to disconnect Slack');
    },
  });

  const handleConnectSlack = () => {
    window.location.href = `${API_BASE_URL}/api/slack/connect`;
  };

  const slackConnected = slackQuery.data?.connected;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <MailCheck className="h-5 w-5" />
          </div>
          <div>
            <span className="text-base font-bold text-slate-900">ReachInbox</span>
            <p className="text-xs text-slate-500">Email Job Scheduler</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {slackConnected ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">
              <MessageSquare className="h-3.5 w-3.5" />
              <span>
                Slack: {slackQuery.data?.teamName}
                {slackQuery.data?.channelName ? ` (${slackQuery.data.channelName})` : ''}
              </span>
              <button
                type="button"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="ml-1 rounded p-0.5 text-emerald-700 hover:bg-emerald-100"
                title="Disconnect Slack"
              >
                <Unplug className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={handleConnectSlack}>
              <MessageSquare className="h-4 w-4" />
              Connect Slack
            </Button>
          )}

          <div className="flex items-center gap-2.5 border-l border-slate-200 pl-3">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="h-8 w-8 rounded-full border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium leading-tight text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onLogout()}
              title="Logout"
              aria-label="Logout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};
