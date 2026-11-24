import React, { useState } from 'react';
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Filter,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ScheduledEmailItem, SentEmailItem } from '../../types';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';

export interface EmailListViewProps {
  mode: 'scheduled' | 'sent';
  onCompose: () => void;
}

type SelectedEmail =
  | ({ kind: 'scheduled' } & ScheduledEmailItem)
  | ({ kind: 'sent' } & SentEmailItem);

export const EmailListView: React.FC<EmailListViewProps> = ({ mode, onCompose }) => {
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState<SelectedEmail | null>(null);
  const pageSize = 20;

  const scheduledQuery = useQuery({
    queryKey: ['emails', 'scheduled', page, searchTerm],
    queryFn: () =>
      searchTerm.trim()
        ? api.searchEmails<ScheduledEmailItem>(
            searchTerm.trim(),
            'scheduled',
            page,
            pageSize,
          )
        : api.getScheduledEmails(page, pageSize),
    enabled: mode === 'scheduled',
    refetchInterval: 5000,
  });

  const sentQuery = useQuery({
    queryKey: ['emails', 'sent', page, searchTerm],
    queryFn: () =>
      searchTerm.trim()
        ? api.searchEmails<SentEmailItem>(
            searchTerm.trim(),
            'sent_or_failed',
            page,
            pageSize,
          )
        : api.getSentEmails(page, pageSize),
    enabled: mode === 'sent',
    refetchInterval: 5000,
  });

  const activeQuery = mode === 'scheduled' ? scheduledQuery : sentQuery;

  // Email Detail View (Figma Image 4)
  if (selected) {
    return (
      <div className="flex-1 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
              aria-label="Back to list"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-semibold text-slate-900">{selected.subject}</h2>
          </div>
          {selected.kind === 'sent' && selected.previewUrl && (
            <a
              href={selected.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500 px-3.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              Open Ethereal Preview
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        <div className="p-8">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
                {selected.recipient.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  To: {selected.recipient}
                </p>
                <p className="text-xs text-slate-400">Status: {selected.status}</p>
              </div>
            </div>
            <span className="text-xs text-slate-400">
              {new Date(
                selected.kind === 'sent' && selected.sentAt
                  ? selected.sentAt
                  : selected.scheduledAt,
              ).toLocaleString()}
            </span>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-6 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Subject: {selected.subject}</p>
            <p className="mt-2 text-slate-500">
              Recipient: {selected.recipient}
              {selected.kind === 'sent' && selected.failureReason
                ? ` — Error: ${selected.failureReason}`
                : ''}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const items = activeQuery.data?.items ?? [];
  const total = activeQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex-1 bg-white">
      {/* Top Search Bar (Figma Images 2 & 3) */}
      <div className="flex items-center gap-4 border-b border-slate-100 px-6 py-3.5">
        <div className="relative max-w-xl flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            placeholder="Search"
            className="w-full rounded-full bg-slate-100 py-2 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Filter"
        >
          <Filter className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void activeQuery.refetch()}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Refresh"
        >
          <RefreshCw
            className={`h-4 w-4 ${activeQuery.isFetching ? 'animate-spin text-emerald-600' : ''}`}
          />
        </button>
      </div>

      {/* Email Rows */}
      {activeQuery.isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="lg" className="text-emerald-600" />
        </div>
      ) : items.length === 0 ? (
        <div className="p-8">
          <EmptyState
            title={mode === 'scheduled' ? 'No scheduled emails' : 'No sent emails yet'}
            description={
              searchTerm
                ? 'No emails matched your search query.'
                : mode === 'scheduled'
                  ? 'Click Compose in the sidebar to schedule your first campaign.'
                  : 'Sent and failed deliveries will appear here.'
            }
            action={
              mode === 'scheduled' && !searchTerm ? (
                <Button onClick={onCompose}>Compose</Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div>
          <ul className="divide-y divide-slate-100">
            {items.map((item) => {
              const isScheduled = mode === 'scheduled';
              const sentItem = item as SentEmailItem;
              return (
                <li
                  key={item.id}
                  onClick={() =>
                    setSelected(
                      isScheduled
                        ? { kind: 'scheduled', ...(item as ScheduledEmailItem) }
                        : { kind: 'sent', ...sentItem },
                    )
                  }
                  className="flex cursor-pointer items-center justify-between gap-4 px-6 py-3.5 transition-colors hover:bg-slate-50"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <span className="w-52 shrink-0 truncate text-sm font-medium text-slate-900">
                      To: {item.recipient}
                    </span>

                    {isScheduled ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-600">
                        <Clock className="h-3 w-3" />
                        {new Date(item.scheduledAt).toLocaleString([], {
                          weekday: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    ) : (
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                          sentItem.status === 'sent'
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {sentItem.status}
                      </span>
                    )}

                    <span className="truncate text-sm font-medium text-slate-900">
                      {item.subject}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {!isScheduled && sentItem.previewUrl && (
                      <a
                        href={sentItem.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
                      >
                        Ethereal
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <Star className="h-4 w-4 text-slate-300" />
                  </div>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
              <span>
                Page {page} of {totalPages} ({total} total)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
