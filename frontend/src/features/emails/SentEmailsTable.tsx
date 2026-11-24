import React, { useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { SentEmailItem } from '../../types';
import { Table, type Column } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';

export const SentEmailsTable: React.FC = () => {
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const pageSize = 15;

  const query = useQuery({
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
    refetchInterval: 5000,
  });

  const columns: Column<SentEmailItem>[] = [
    {
      key: 'recipient',
      header: 'Email',
      render: (item) => <span className="font-medium text-slate-900">{item.recipient}</span>,
    },
    {
      key: 'subject',
      header: 'Subject',
      render: (item) => <span className="line-clamp-1">{item.subject}</span>,
    },
    {
      key: 'sentAt',
      header: 'Sent Time',
      render: (item) => (
        <span className="whitespace-nowrap text-slate-600">
          {item.sentAt
            ? new Date(item.sentAt).toLocaleString()
            : new Date(item.scheduledAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => (
        <Badge variant={item.status === 'sent' ? 'success' : 'danger'}>
          {item.status}
        </Badge>
      ),
    },
    {
      key: 'preview',
      header: 'Preview',
      render: (item) =>
        item.previewUrl ? (
          <a
            href={item.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
          >
            Ethereal
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="text-xs text-slate-400">
            {item.failureReason ? item.failureReason.slice(0, 40) : '—'}
          </span>
        ),
    },
  ];

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          placeholder="Search sent emails (Elasticsearch)..."
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-16">
          <Spinner size="lg" className="text-emerald-600" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No sent emails yet"
          description={
            searchTerm
              ? 'No sent or failed emails matched your search query.'
              : 'Completed and failed email deliveries will appear here.'
          }
        />
      ) : (
        <>
          <Table columns={columns} data={items} keyExtractor={(item) => item.id} />
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-slate-600">
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
        </>
      )}
    </div>
  );
};
