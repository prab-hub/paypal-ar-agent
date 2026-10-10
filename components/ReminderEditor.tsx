'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LedgerRow } from '@/lib/ar';
import { money } from '@/lib/format';

type Reminder = { subject: string; note: string; tone: string; reasoning: string };

const TONE: Record<string, string> = {
  friendly: 'bg-emerald-100 text-emerald-800',
  neutral: 'bg-slate-100 text-slate-700',
  firm: 'bg-amber-100 text-amber-800',
  final: 'bg-red-100 text-red-800',
};

// AI drafts a reminder for one invoice; the user edits it and sends it through PayPal.
export default function ReminderEditor({ row, onSent, compact = false }: { row: LedgerRow; onSent?: () => void; compact?: boolean }) {
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const draft = useCallback(async () => {
    setReminder(null);
    setSent(false);
    setMsg('AI is drafting a reminder...');
    setBusy(true);
    const res = await fetch(`/api/invoices/${row.id}/remind`);
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(d.error);
    setReminder(d);
    setMsg('');
  }, [row.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drafting starts when the editor opens
    draft();
  }, [draft]);

  async function send() {
    if (!reminder) return;
    setBusy(true);
    const res = await fetch(`/api/invoices/${row.id}/remind`, { method: 'POST', body: JSON.stringify(reminder) });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(d.error);
    setSent(true);
    setMsg(`Sent to ${row.email} through PayPal.`);
    onSent?.();
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-sm">
      {!compact && (
        <div className="font-medium">
          Reminder for invoice {row.number}, {row.customer} ({money(row.balance, row.currency)},{' '}
          {row.daysOverdue === null ? 'no due date' : row.daysOverdue > 0 ? `${row.daysOverdue} days late` : row.daysOverdue === 0 ? 'due today' : `due in ${-row.daysOverdue} days`})
        </div>
      )}
      {reminder && !sent && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-slate-600">
            <span className={`mr-1 rounded px-1.5 py-0.5 font-medium ${TONE[reminder.tone] ?? ''}`}>{reminder.tone}</span>
            {reminder.reasoning}
          </p>
          <input aria-label="Subject" className="w-full rounded border border-slate-300 bg-white p-2" value={reminder.subject} onChange={(e) => setReminder({ ...reminder, subject: e.target.value })} />
          <textarea aria-label="Message" className="h-36 w-full rounded border border-slate-300 bg-white p-2" value={reminder.note} onChange={(e) => setReminder({ ...reminder, note: e.target.value })} />
          <div className="flex gap-2">
            <button className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-50" disabled={busy} onClick={send}>
              Approve and send via PayPal
            </button>
            <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 disabled:opacity-50" disabled={busy} onClick={draft}>
              Redraft
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`mt-2 ${sent ? 'text-emerald-700' : ''}`}>{msg}</p>}
    </div>
  );
}
