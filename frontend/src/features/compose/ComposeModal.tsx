import React, { useMemo, useState } from 'react';
import { Upload, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { parseRecipientsText } from '../../utils/csvParser';
import { useToast } from '../../hooks/useToast';

export interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
}

function getDefaultStartTimeLocal(): string {
  const d = new Date(Date.now() + 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({ open, onClose }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [rawRecipients, setRawRecipients] = useState('');
  const [startTimeLocal, setStartTimeLocal] = useState(getDefaultStartTimeLocal);
  const [delayBetweenEmailsMs, setDelayBetweenEmailsMs] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [senderId, setSenderId] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const sendersQuery = useQuery({
    queryKey: ['senders'],
    queryFn: api.getSenders,
    enabled: open,
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
      setSubject('');
      setBody('');
      setRawRecipients('');
      setValidationError(null);
      onClose();
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!subject.trim()) {
      setValidationError('Subject is required.');
      return;
    }
    if (!body.trim()) {
      setValidationError('Email body is required.');
      return;
    }
    if (parsed.validEmails.length === 0) {
      setValidationError('Please provide at least one valid email address.');
      return;
    }

    const startDate = new Date(startTimeLocal);
    if (Number.isNaN(startDate.getTime())) {
      setValidationError('Please provide a valid start date and time.');
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compose New Email"
      subtitle="Upload leads, configure pacing & hourly limits, and schedule delivery."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {validationError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {validationError}
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-600">
              From (Ethereal Sender)
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={createSenderMutation.isPending}
              onClick={() => createSenderMutation.mutate()}
            >
              <Plus className="h-3.5 w-3.5" />
              New Ethereal Sender
            </Button>
          </div>
          <select
            value={senderId || senders[0]?.id || ''}
            onChange={(e) => setSenderId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            {senders.length === 0 ? (
              <option value="">No senders yet — click "New Ethereal Sender"</option>
            ) : (
              senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email})
                </option>
              ))
            )}
          </select>
        </div>

        <Input
          label="Subject"
          placeholder="Quick question about your Q4 outreach"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-600">
            Body
          </label>
          <textarea
            rows={4}
            placeholder="Write your email message here..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-600">
              Recipients (CSV / Text)
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <Upload className="h-3.5 w-3.5" />
              Upload CSV/TXT
              <input
                type="file"
                accept=".csv,.txt"
                onChange={(e) => void handleFileUpload(e)}
                className="hidden"
              />
            </label>
          </div>
          <textarea
            rows={3}
            placeholder="alice@example.com, bob@example.com"
            value={rawRecipients}
            onChange={(e) => setRawRecipients(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-emerald-700">
              {parsed.validEmails.length} email address{parsed.validEmails.length === 1 ? '' : 'es'} detected
            </span>
            {parsed.duplicateCount > 0 && (
              <span className="text-slate-500">
                ({parsed.duplicateCount} duplicate{parsed.duplicateCount === 1 ? '' : 's'} removed)
              </span>
            )}
            {parsed.invalidEntries.length > 0 && (
              <span className="text-amber-600">
                ({parsed.invalidEntries.length} invalid skipped)
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Start Time"
            type="datetime-local"
            value={startTimeLocal}
            onChange={(e) => setStartTimeLocal(e.target.value)}
          />
          <Input
            label="Delay Between (ms)"
            type="number"
            min={0}
            value={delayBetweenEmailsMs}
            onChange={(e) => setDelayBetweenEmailsMs(Number(e.target.value))}
          />
          <Input
            label="Hourly Limit"
            type="number"
            min={1}
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(Number(e.target.value))}
          />
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={scheduleMutation.isPending}>
            Schedule {parsed.validEmails.length > 0 ? `(${parsed.validEmails.length})` : ''}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
