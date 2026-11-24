import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bold,
  Calendar,
  Clock,
  Italic,
  List,
  ListOrdered,
  Paperclip,
  Plus,
  Quote,
  Redo,
  Underline,
  Undo,
  Upload,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { parseRecipientsText } from '../../utils/csvParser';
import { useToast } from '../../hooks/useToast';
import { Spinner } from '../../components/ui/Spinner';

export interface ComposeViewProps {
  onBack: () => void;
}

function formatLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getPresetDate(hoursOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hoursOffset, 0, 0, 0);
  return formatLocalDatetimeInput(d);
}

export const ComposeView: React.FC<ComposeViewProps> = ({ onBack }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [rawRecipients, setRawRecipients] = useState('');
  const [startTimeLocal, setStartTimeLocal] = useState(() =>
    formatLocalDatetimeInput(new Date(Date.now() + 60 * 1000)),
  );
  const [delayBetweenEmailsMs, setDelayBetweenEmailsMs] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [senderId, setSenderId] = useState('');
  const [sendLaterOpen, setSendLaterOpen] = useState(false);

  const sendersQuery = useQuery({
    queryKey: ['senders'],
    queryFn: api.getSenders,
  });

  const createSenderMutation = useMutation({
    mutationFn: () => api.createSender(),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['senders'] });
      setSenderId(res.sender.id);
      showToast('success', `Created Ethereal sender: ${res.sender.email}`);
    },
    onError: (err) => {
      showToast('error', err instanceof Error ? err.message : 'Failed to create sender');
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: api.scheduleEmails,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['emails'] });
      showToast('success', `Scheduled ${res.scheduledCount} email(s) successfully`);
      onBack();
    },
    onError: (err) => {
      showToast('error', err instanceof Error ? err.message : 'Failed to schedule emails');
    },
  });

  const parsed = useMemo(() => parseRecipientsText(rawRecipients), [rawRecipients]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawRecipients((prev) => (prev ? `${prev}\n${text}` : text));
  };

  const handleSubmit = () => {
    if (!subject.trim()) {
      showToast('error', 'Subject is required.');
      return;
    }
    if (!body.trim()) {
      showToast('error', 'Email body is required.');
      return;
    }
    if (parsed.validEmails.length === 0) {
      showToast('error', 'Please enter or upload at least one valid email address.');
      return;
    }
    const startDate = new Date(startTimeLocal);
    if (Number.isNaN(startDate.getTime())) {
      showToast('error', 'Please pick a valid start date & time.');
      return;
    }

    const effectiveSenderId =
      senderId || sendersQuery.data?.senders?.[0]?.id || undefined;

    scheduleMutation.mutate({
      subject: subject.trim(),
      body: body.trim(),
      recipients: parsed.validEmails,
      startTime: startDate.toISOString(),
      delayBetweenEmailsMs: Number(delayBetweenEmailsMs) || 0,
      hourlyLimit: Number(hourlyLimit) || 100,
      senderId: effectiveSenderId,
    });
  };

  const senders = sendersQuery.data?.senders ?? [];
  const visiblePills = parsed.validEmails.slice(0, 3);
  const overflowCount = Math.max(0, parsed.validEmails.length - 3);

  return (
    <div className="min-h-screen bg-white">
      {/* Top Compose Header */}
      <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-slate-900">Compose New Email</h1>
        </div>

        <div className="relative flex items-center gap-3">
          <label
            className="cursor-pointer rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            title="Upload CSV/TXT list"
          >
            <Paperclip className="h-4 w-4" />
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(e) => void handleFileUpload(e)}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() => setSendLaterOpen((o) => !o)}
            className={`rounded-lg p-2 transition-colors ${
              sendLaterOpen
                ? 'bg-emerald-50 text-emerald-600'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
            title="Pick schedule time"
          >
            <Clock className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={scheduleMutation.isPending}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-500 px-5 py-1.5 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-60"
          >
            {scheduleMutation.isPending && <Spinner size="sm" />}
            Send Later
          </button>

          {/* Send Later Popover (Figma Image 5) */}
          {sendLaterOpen && (
            <div className="absolute right-0 top-12 z-30 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Send Later</h3>
              <div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2">
                <Calendar className="h-4 w-4 text-slate-400" />
                <input
                  type="datetime-local"
                  value={startTimeLocal}
                  onChange={(e) => setStartTimeLocal(e.target.value)}
                  className="w-full text-xs text-slate-700 focus:outline-none"
                />
              </div>
              <div className="space-y-1.5 text-xs text-slate-600">
                <button
                  type="button"
                  onClick={() => setStartTimeLocal(getPresetDate(9))}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
                >
                  Tomorrow, 9:00 AM
                </button>
                <button
                  type="button"
                  onClick={() => setStartTimeLocal(getPresetDate(10))}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
                >
                  Tomorrow, 10:00 AM
                </button>
                <button
                  type="button"
                  onClick={() => setStartTimeLocal(getPresetDate(11))}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
                >
                  Tomorrow, 11:00 AM
                </button>
                <button
                  type="button"
                  onClick={() => setStartTimeLocal(getPresetDate(15))}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
                >
                  Tomorrow, 3:00 PM
                </button>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSendLaterOpen(false)}
                  className="rounded-full px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setSendLaterOpen(false)}
                  className="rounded-full border border-emerald-500 px-4 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Compose Form Body */}
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* From Row */}
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 py-3">
          <span className="w-20 text-xs font-medium text-slate-500">From</span>
          <select
            value={senderId || senders[0]?.id || ''}
            onChange={(e) => setSenderId(e.target.value)}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800 focus:outline-none"
          >
            {senders.length === 0 ? (
              <option value="">No Ethereal sender yet</option>
            ) : (
              senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => createSenderMutation.mutate()}
            disabled={createSenderMutation.isPending}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            {createSenderMutation.isPending ? 'Creating...' : 'New Ethereal Sender'}
          </button>
        </div>

        {/* To Row */}
        <div className="border-b border-slate-100 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <span className="w-20 text-xs font-medium text-slate-500">To</span>
              {visiblePills.map((email) => (
                <span
                  key={email}
                  className="rounded-full border border-emerald-400 bg-emerald-50/40 px-2.5 py-0.5 text-xs font-medium text-slate-800"
                >
                  {email}
                </span>
              ))}
              {overflowCount > 0 && (
                <span className="rounded-full border border-emerald-400 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  +{overflowCount}
                </span>
              )}
              <input
                type="text"
                placeholder="recipient@example.com (or paste comma/newline list)"
                value={rawRecipients}
                onChange={(e) => setRawRecipients(e.target.value)}
                className="min-w-[220px] flex-1 py-1 text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
              />
            </div>

            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-emerald-600 hover:underline">
              <Upload className="h-3.5 w-3.5" />
              Upload List
              <input
                type="file"
                accept=".csv,.txt"
                onChange={(e) => void handleFileUpload(e)}
                className="hidden"
              />
            </label>
          </div>
          {rawRecipients.trim() && (
            <div className="mt-1.5 pl-24 text-xs text-slate-500">
              <span className="font-medium text-emerald-700">
                {parsed.validEmails.length} email address
                {parsed.validEmails.length === 1 ? '' : 'es'} detected
              </span>
              {parsed.duplicateCount > 0 && ` • ${parsed.duplicateCount} duplicates removed`}
              {parsed.invalidEntries.length > 0 &&
                ` • ${parsed.invalidEntries.length} invalid skipped`}
            </div>
          )}
        </div>

        {/* Subject Row */}
        <div className="flex items-center gap-4 border-b border-slate-100 py-3">
          <span className="w-20 text-xs font-medium text-slate-500">Subject</span>
          <input
            type="text"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
          />
        </div>

        {/* Delay & Hourly Limit Row */}
        <div className="flex flex-wrap items-center gap-6 py-4">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            Delay between 2 emails (ms)
            <input
              type="number"
              min={0}
              value={delayBetweenEmailsMs}
              onChange={(e) => setDelayBetweenEmailsMs(Number(e.target.value))}
              className="w-20 rounded-lg border border-slate-200 px-2.5 py-1.5 text-center text-xs text-slate-700 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            Hourly Limit
            <input
              type="number"
              min={1}
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(Number(e.target.value))}
              className="w-20 rounded-lg border border-slate-200 px-2.5 py-1.5 text-center text-xs text-slate-700 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <span className="text-xs text-slate-400">
            Scheduled for: {new Date(startTimeLocal).toLocaleString()}
          </span>
        </div>

        {/* Editor Box (Figma Images 5-7) */}
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-white px-3 py-2 text-slate-400 shadow-sm">
            <Undo className="h-3.5 w-3.5" />
            <Redo className="h-3.5 w-3.5" />
            <span className="h-4 w-px bg-slate-200" />
            <Bold className="h-3.5 w-3.5" />
            <Italic className="h-3.5 w-3.5" />
            <Underline className="h-3.5 w-3.5" />
            <span className="h-4 w-px bg-slate-200" />
            <ListOrdered className="h-3.5 w-3.5" />
            <List className="h-3.5 w-3.5" />
            <Quote className="h-3.5 w-3.5" />
          </div>
          <textarea
            rows={12}
            placeholder="Type Your Reply..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full resize-none bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
};
