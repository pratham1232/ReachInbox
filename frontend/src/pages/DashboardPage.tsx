import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { AuthUser } from '../types';
import { DashboardHeader } from '../features/dashboard/DashboardHeader';
import { Tabs } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { ScheduledEmailsTable } from '../features/emails/ScheduledEmailsTable';
import { SentEmailsTable } from '../features/emails/SentEmailsTable';
import { ComposeModal } from '../features/compose/ComposeModal';
import { useToast } from '../hooks/useToast';

export interface DashboardPageProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

type DashboardTab = 'scheduled' | 'sent';

export const DashboardPage: React.FC<DashboardPageProps> = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('scheduled');
  const [composeOpen, setComposeOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

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

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader user={user} onLogout={onLogout} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Tabs
            tabs={[
              { id: 'scheduled', label: 'Scheduled Emails' },
              { id: 'sent', label: 'Sent Emails' },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
          />

          <Button onClick={() => setComposeOpen(true)}>
            <Plus className="h-4 w-4" />
            Compose New Email
          </Button>
        </div>

        {activeTab === 'scheduled' ? (
          <ScheduledEmailsTable onCompose={() => setComposeOpen(true)} />
        ) : (
          <SentEmailsTable />
        )}
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
};
