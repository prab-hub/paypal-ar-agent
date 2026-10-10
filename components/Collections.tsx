'use client';

import { useState } from 'react';
import { collectionsQueue, REMIND_EVERY_DAYS, type LedgerRow } from '@/lib/ar';
import { money } from '@/lib/format';
import ReminderEditor from './ReminderEditor';

// Today's collections queue: Settle proposes who to chase, AI drafts each reminder, a human approves each send.
export default function Collections({ rows, reminded, onSent }: { rows: LedgerRow[]; reminded: Record<string, string>; onSent: () => void }) {
  const queue = collectionsQueue(rows, reminded);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Today&apos;s collections queue</h2>
        {queue.length > 0 && (
          <button className="text-sm text-blue-700 hover:underline" onClick={() => setOpen(new Set(queue.map((q) => q.row.id)))}>
            Draft all {queue.length} with AI
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Invoices due within 3 days or overdue, not reminded in the last {REMIND_EVERY_DAYS} days, ranked by balance x
        lateness (unopened invoices first: they were probably missed). Nothing is sent until you approve it.
      </p>
      {queue.length === 0 ? (
        <p className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">Nothing to chase today.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {queue.map(({ row, why }, i) => (
            <li key={row.id} className="rounded-lg border border-slate-200">
              <button className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50" onClick={() => toggle(row.id)} aria-expanded={open.has(row.id)}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{row.customer}</span>
                  <span className="ml-2 text-xs text-slate-500">Invoice {row.number}</span>
                  <span className="block text-xs text-slate-500">{why}</span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">{money(row.balance)}</span>
                  <span className="text-xs text-slate-500">{row.currency}</span>
                </span>
                <span className="text-slate-400">{open.has(row.id) ? '−' : '+'}</span>
              </button>
              {open.has(row.id) && (
                <div className="border-t border-slate-200 p-3">
                  <ReminderEditor row={row} onSent={onSent} compact />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
