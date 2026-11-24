import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ScheduledEmailItem } from '../../types';
import { Table, type Column } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';

export interface ScheduledEmailsTableProps {
  onCompose: () => void;
}

export const ScheduledEmailsTable: React.FC<ScheduledEmailsTableProps> = ({
  onCompose,
}) => {
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const pageSize = 15;

  const query = useQuery({
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
    refetchInterval: 5000,
  });

  const columns: Column<ScheduledEmailItem>[] = [
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
      key: 'scheduledAt',
      header: 'Scheduled Time',
      render: (item) => (
        <span className="whitespace-nowrap text-slate-600">
          {new Date(item.scheduledAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => (
        <Badge variant={item.status === 'processing' ? 'info' : 'warning'}>
          {item.status}
        </Badge>
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
          placeholder="Search scheduled emails (Elasticsearch)..."
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-16">
          <Spinner size="lg" className="text-emerald-600" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No scheduled emails"
          description={
            searchTerm
              ? 'No scheduled emails matched your search query.'
              : 'Schedule a new email campaign to see upcoming jobs here.'
          }
          action={
            !searchTerm ? (
              <Button onClick={onCompose}>Compose New Email</Button>
            ) : undefined
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
