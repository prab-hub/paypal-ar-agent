'use client';

import { useCallback, useEffect, useState } from 'react';
import { money } from '@/lib/format';

type Payment = { id: string; date: string; method: string; type: string; gross: number; fee: number | null; net: number | null; note: string; held?: boolean };
type Row = {
  invoiceId: string; number: string; customer: string; currency: string; total: number; received: number; fees: number; net: number;
  balance: number; status: 'matched' | 'short_pay' | 'partial' | 'unapplied'; explanation: string; payments: Payment[];
};
type Data = { rows: Row[]; unapplied: Row[]; transactionSearch: 'ok' | 'not_enabled' | 'error' };

const BADGE: Record<Row['status'], [string, string]> = {
  matched: ['Matched', 'bg-emerald-100 text-emerald-800'],
  short_pay: ['Short pay', 'bg-amber-100 text-amber-800'],
  partial: ['Partial', 'bg-sky-100 text-sky-800'],
  unapplied: ['Unapplied cash', 'bg-red-100 text-red-800'],
};

export default function Reconcile({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setBusy('load');
    const res = await fetch('/api/reconcile');
    const d = await res.json();
    setBusy('');
    if (!res.ok) return setMsg(d.error);
    setData(d);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once when the tab opens
    load();
  }, [load]);

  async function invoiceBalance(r: Row) {
    if (!confirm(`Create and send a new PayPal invoice for ${money(r.balance, r.currency)} to ${r.customer}, and close invoice ${r.number}?`)) return;
    setBusy(r.invoiceId);
    const res = await fetch(`/api/invoices/${r.invoiceId}/balance`, { method: 'POST' });
    const d = await res.json();
    setBusy('');
    if (!res.ok) return setMsg(d.error);
    setMsg(`Invoice ${d.number} sent for the balance; invoice ${r.number} is closed.`);
    onChange();
    load();
  }

  const rows = data ? [...data.rows, ...data.unapplied] : [];
  const sum = (k: 'received' | 'fees' | 'net') => rows.reduce((s, r) => s + r[k], 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Cash reconciliation</h2>
        <button className="text-sm text-blue-700 hover:underline" onClick={load} disabled={!!busy}>
          {busy === 'load' ? 'Matching...' : 'Re-run from PayPal'}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Every payment matched to its invoice, with PayPal fees and what actually lands in the bank. Small gaps after a
        payment are short pays (bank or FX charges), bigger ones are partial payments still in collections.
      </p>
      {data?.transactionSearch === 'not_enabled' && (
        <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
          Unapplied cash check is off: Transaction Search isn&apos;t enabled on this PayPal app yet, so only invoice payments are matched.
        </p>
      )}
      {msg && <p className="mt-2 text-sm text-slate-700">{msg}</p>}
      {data && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {([['Received', sum('received')], ['PayPal fees', sum('fees')], ['Net to bank', sum('net')]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="text-xl font-semibold tabular-nums">{money(v)}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2">Invoice</th>
                  <th>Customer</th>
                  <th className="text-right">Invoiced</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Fees</th>
                  <th className="text-right">Gap</th>
                  <th className="pl-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.invoiceId || r.payments[0]?.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 font-medium">{r.number || 'none'}</td>
                    <td>
                      {r.customer}
                      <div className="text-xs text-slate-500">
                        {r.payments.map((p) => `${p.date} ${p.method.replaceAll('_', ' ').toLowerCase()} ${money(p.gross)}`).join(', ')}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{r.total ? money(r.total) : ''}</td>
                    <td className="text-right tabular-nums">{money(r.received)}</td>
                    <td className="text-right tabular-nums">{r.fees ? money(r.fees) : r.payments.some((p) => p.held && p.fee === null) ? <span className="text-xs text-slate-500">pending</span> : '0.00'}</td>
                    <td className={`text-right tabular-nums ${r.balance ? 'font-semibold text-amber-700' : ''}`}>{money(r.balance)}</td>
                    <td className="max-w-72 pl-4">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[r.status][1]}`}>{BADGE[r.status][0]}</span>
                      <div className="mt-1 text-xs text-slate-600">{r.explanation}</div>
                      {r.status === 'short_pay' && (
                        <button className="mt-1 text-xs font-medium text-blue-700 hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => invoiceBalance(r)}>
                          {busy === r.invoiceId ? 'Working...' : 'Invoice the balance'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No payments yet.</p>}
          </div>
        </>
      )}
    </section>
  );
}
