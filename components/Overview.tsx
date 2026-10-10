'use client';

import { useEffect, useState } from 'react';
import type { summarize } from '@/lib/ar';
import { money } from '@/lib/format';

type Summary = ReturnType<typeof summarize>;
type FeedEvent = { id: string; type: string; summary: string; at: string; resourceId: string };

function Tile({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-slate-500">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// Aging: one series (open balance) across ordered buckets, so a single hue; values in text ink, not bar color.
function Aging({ summary }: { summary: Summary }) {
  const max = Math.max(1, ...summary.aging.map((b) => b.amount));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold text-slate-900">AR aging</div>
        <div className="text-xs text-slate-500">days past due, {summary.currency}</div>
      </div>
      <div className="mt-3 flex h-36 items-end gap-3" role="list">
        {summary.aging.map((b) => (
          <div key={b.label} role="listitem" className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${b.label}: ${money(b.amount)} across ${b.count} invoice${b.count === 1 ? '' : 's'}`}>
            <div className="mb-1 text-xs tabular-nums text-slate-700">{b.amount ? money(b.amount).replace(/\.00$/, '') : '0'}</div>
            <div
              className="w-full max-w-14 rounded-t bg-[#2a78d6] transition-opacity group-hover:opacity-80"
              style={{ height: `${Math.max(b.amount ? 4 : 1, (b.amount / max) * 100)}%`, opacity: b.amount ? 1 : 0.25 }}
            />
            <div className="mt-1.5 text-xs font-medium text-slate-600">{b.label}</div>
            <div className="text-[11px] text-slate-400">{b.count} inv</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Events({ onEvent }: { onEvent: () => void }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  useEffect(() => {
    let last = '';
    const poll = () =>
      fetch('/api/events')
        .then((r) => r.json())
        .then((d: { events: FeedEvent[] }) => {
          setEvents(d.events);
          const top = d.events[0]?.id ?? '';
          if (last && top && top !== last) onEvent(); // a payment or dispute arrived: reload the ledger
          last = top;
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 20_000);
    return () => clearInterval(t);
  }, [onEvent]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Live from PayPal webhooks
      </div>
      {events.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Waiting for events. When a customer pays, a dispute opens or an invoice is cancelled, PayPal calls Settle and the ledger refreshes on its own.
        </p>
      ) : (
        <ul className="mt-2 max-h-32 space-y-1.5 overflow-y-auto text-xs">
          {events.map((e) => (
            <li key={e.id} className="flex justify-between gap-2">
              <span className="text-slate-700">{e.summary}{e.resourceId ? ` (${e.resourceId})` : ''}</span>
              <span className="shrink-0 text-slate-400">{new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Overview({ summary, onEvent }: { summary: Summary | null; onEvent: () => void }) {
  if (!summary) return <div className="h-40 animate-pulse rounded-xl bg-slate-100" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Outstanding" value={money(summary.openAmount)} unit={summary.currency} sub={`${summary.openCount} open invoices`} />
        <Tile label="Overdue" value={money(summary.overdueAmount)} unit={summary.currency} sub={`${summary.overdueCount} invoices past due`} />
        <Tile label="DSO" value={summary.dso === null ? 'n/a' : `${summary.dso} days`} sub="AR / last 90 days billed x 90" />
        <Tile label="Paid" value={String(summary.paidCount)} sub="invoices settled" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Aging summary={summary} />
        <Events onEvent={onEvent} />
      </div>
    </div>
  );
}
