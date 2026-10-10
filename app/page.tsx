'use client';

import { useCallback, useEffect, useState } from 'react';
import NewInvoice from '@/components/NewInvoice';
import Ledger from '@/components/Ledger';
import AgentChat from '@/components/AgentChat';
import RevRec from '@/components/RevRec';
import Overview from '@/components/Overview';
import Collections from '@/components/Collections';
import Reconcile from '@/components/Reconcile';
import Disputes from '@/components/Disputes';
import type { LedgerRow, summarize } from '@/lib/ar';

type Summary = ReturnType<typeof summarize>;
type Ledger = { error?: string; rows?: LedgerRow[]; summary?: Summary; reminded?: Record<string, string> };

const TABS = [
  ['invoices', 'Invoices'],
  ['collections', 'Collections'],
  ['reconcile', 'Reconciliation'],
  ['disputes', 'Disputes'],
  ['revenue', 'Revenue'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function Home() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('invoices');
  const [reset, setReset] = useState('');

  const apply = useCallback((ok: boolean, d: Ledger) => {
    setLoading(false);
    if (!ok) return setError(d.error ?? 'Could not load invoices');
    setError('');
    setRows(d.rows ?? []);
    setSummary(d.summary ?? null);
    setReminded(d.reminded ?? {});
  }, []);

  const fetchLedger = () => fetch('/api/invoices').then(async (res) => ({ ok: res.ok, d: (await res.json()) as Ledger }));

  const refresh = useCallback(() => {
    setLoading(true);
    fetchLedger().then(({ ok, d }) => apply(ok, d));
  }, [apply]);

  useEffect(() => {
    fetchLedger().then(({ ok, d }) => apply(ok, d));
  }, [apply]);

  // Tabs are linkable (#collections, #disputes...) so a demo can open straight on one.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the URL once on load
    if (TABS.some(([id]) => id === h)) setTab(h as Tab);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };

  async function resetDemo() {
    if (!confirm('Replace the demo invoices with a fresh set of 10 (across every collection stage)? Invoices you created yourself are kept.')) return;
    setReset('Resetting demo data on PayPal (about 30 seconds)...');
    const res = await fetch('/api/demo/reset', { method: 'POST' });
    const d = await res.json();
    setReset(res.ok ? `Fresh demo data: ${d.created} invoices created.${d.failed?.length ? ` ${d.failed.length} failed.` : ''}` : d.error);
    refresh();
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-700 text-sm font-bold text-white">S</span>
            <h1 className="text-2xl font-bold tracking-tight">Settle</h1>
          </div>
          <p className="mt-1 max-w-2xl text-slate-600">
            AI accounts receivable on PayPal: quote to invoice, collections, reconciliation, disputes and revenue recognition, with an agent that knows who owes what.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50" onClick={resetDemo} disabled={reset.startsWith('Resetting')}>
            Reset demo data
          </button>
          {reset && <span className="max-w-72 text-right text-xs text-slate-600">{reset}</span>}
        </div>
      </header>
      <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Live demo on the <b>PayPal sandbox</b>: no real money moves and no real emails are sent. Use a sandbox buyer as the customer, e.g.{' '}
        <code className="font-mono">sb-wx9uk53193568@personal.example.com</code>. Anything that changes an invoice asks for your approval first.
      </p>
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Overview summary={summary} onEvent={refresh} />
          <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => go(id)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === 'invoices' && (
            <>
              <NewInvoice onCreated={refresh} />
              <Ledger rows={rows} loading={loading} onRefresh={refresh} />
            </>
          )}
          {tab === 'collections' && <Collections rows={rows} reminded={reminded} onSent={refresh} />}
          {tab === 'reconcile' && <Reconcile onChange={refresh} />}
          {tab === 'disputes' && <Disputes />}
          {tab === 'revenue' && <RevRec />}
        </div>
        <AgentChat onAction={refresh} />
      </div>
    </main>
  );
}
