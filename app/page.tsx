'use client';

import { useCallback, useEffect, useState } from 'react';
import NewInvoice from '@/components/NewInvoice';
import Ledger from '@/components/Ledger';
import AgentChat from '@/components/AgentChat';
import RevRec from '@/components/RevRec';
import type { LedgerRow, summarize } from '@/lib/ar';

export default function Home() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [summary, setSummary] = useState<ReturnType<typeof summarize> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const apply = useCallback((ok: boolean, d: { error?: string; rows?: LedgerRow[]; summary?: ReturnType<typeof summarize> }) => {
    setLoading(false);
    if (!ok) return setError(d.error ?? 'Could not load invoices');
    setError('');
    setRows(d.rows ?? []);
    setSummary(d.summary ?? null);
  }, []);

  const fetchLedger = () => fetch('/api/invoices').then(async (res) => ({ ok: res.ok, d: await res.json() }));

  const refresh = useCallback(() => {
    setLoading(true);
    fetchLedger().then(({ ok, d }) => apply(ok, d));
  }, [apply]);

  useEffect(() => {
    fetchLedger().then(({ ok, d }) => apply(ok, d));
  }, [apply]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Settle</h1>
        <p className="text-gray-600">AI accounts receivable on PayPal: quote to invoice, collections, revenue recognition, and an agent that knows who owes what.</p>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Live demo on the <b>PayPal sandbox</b>: no real money moves and no real emails are sent. Use a sandbox buyer
          as the customer, e.g. <code className="font-mono">sb-wx9uk53193568@personal.example.com</code>. Anything
          that changes an invoice asks for your approval first.
        </p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </header>
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="flex min-w-0 flex-col gap-6">
          <NewInvoice onCreated={refresh} />
          <Ledger rows={rows} summary={summary} loading={loading} onRefresh={refresh} />
        </div>
        <AgentChat onAction={refresh} />
      </div>
      <div className="mt-6">
        <RevRec />
      </div>
    </main>
  );
}
