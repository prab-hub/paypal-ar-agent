'use client';

import { useState } from 'react';
import type { Draft } from '@/lib/extract';

const SAMPLE = `Hi Sam,

Thanks for approving the Q4 website retainer. As agreed on our call:
- Design sprint for the new pricing page: 24 hours at $95/hr
- Webflow build and QA: 1 fixed fee of $1,800
- Monthly hosting + maintenance (October): $250

Please bill Northwind Studio, accounts@northwind.example (PO #NW-4471). Net 15 is fine.

Thanks,
Priya`;

type Status = { kind: 'idle' | 'busy' | 'error' | 'done'; msg?: string };

export default function NewInvoice({ onCreated }: { onCreated: () => void }) {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function extract() {
    setStatus({ kind: 'busy', msg: 'Reading the text...' });
    const res = await fetch('/api/extract', { method: 'POST', body: JSON.stringify({ text }) });
    const d = await res.json();
    if (!res.ok) return setStatus({ kind: 'error', msg: d.error });
    setDraft(d);
    setStatus({ kind: 'idle' });
  }

  async function create(send: boolean) {
    if (!draft) return;
    setStatus({ kind: 'busy', msg: send ? 'Creating and sending on PayPal...' : 'Saving draft on PayPal...' });
    const res = await fetch('/api/invoices', { method: 'POST', body: JSON.stringify({ ...draft, send }) });
    const d = await res.json();
    if (!res.ok) return setStatus({ kind: 'error', msg: d.error });
    setStatus({ kind: 'done', msg: `Invoice ${d.number} ${send ? 'sent' : 'saved as draft'} on PayPal.` });
    setDraft(null);
    setText('');
    onCreated();
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => draft && setDraft({ ...draft, [k]: v });
  const setItem = (i: number, k: keyof Draft['items'][number], v: string) =>
    draft &&
    setDraft({
      ...draft,
      items: draft.items.map((it, j) => (j === i ? { ...it, [k]: k === 'quantity' || k === 'unit_price' ? Number(v) : v } : it)),
    });
  const total = draft?.items.reduce((s, i) => s + i.quantity * i.unit_price, 0) ?? 0;
  const busy = status.kind === 'busy';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Quote to invoice</h2>
        {!draft && (
          <button className="text-sm text-blue-700 hover:underline" onClick={() => setText(SAMPLE)}>
            Use sample
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Paste a scope, quote, PO or email thread. AI drafts the invoice; you check it; PayPal sends it.
      </p>

      {!draft ? (
        <>
          <textarea
            className="mt-3 h-48 w-full rounded-lg border border-gray-300 p-3 font-mono text-sm"
            placeholder="Paste text here"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy || text.trim().length < 20}
            onClick={extract}
          >
            Draft invoice with AI
          </button>
        </>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          {draft.warnings.length > 0 && (
            <ul className="rounded-lg bg-amber-50 p-3 text-amber-900">
              {draft.warnings.map((w, i) => (
                <li key={i}>Check: {w}</li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              Customer
              <input className="rounded border p-2" value={draft.customer_name} onChange={(e) => set('customer_name', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              Billing email
              <input className="rounded border p-2" value={draft.customer_email} onChange={(e) => set('customer_email', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              Currency
              <input className="rounded border p-2" value={draft.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
            </label>
            <label className="flex flex-col gap-1">
              Due in (days)
              <input
                type="number"
                className="rounded border p-2"
                value={draft.due_in_days}
                onChange={(e) => set('due_in_days', Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              PO / reference
              <input className="rounded border p-2" value={draft.po_number} onChange={(e) => set('po_number', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              Note to customer
              <input className="rounded border p-2" value={draft.note} onChange={(e) => set('note', e.target.value)} />
            </label>
          </div>
          <table className="w-full">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">Item</th>
                <th className="w-20">Qty</th>
                <th className="w-28">Unit price</th>
                <th className="w-24 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {draft.items.map((it, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input className="w-full rounded border p-1" value={it.name} onChange={(e) => setItem(i, 'name', e.target.value)} />
                  </td>
                  <td className="pr-2">
                    <input type="number" className="w-full rounded border p-1" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
                  </td>
                  <td className="pr-2">
                    <input type="number" className="w-full rounded border p-1" value={it.unit_price} onChange={(e) => setItem(i, 'unit_price', e.target.value)} />
                  </td>
                  <td className="text-right tabular-nums">{(it.quantity * it.unit_price).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-2 text-right font-medium">
                  Total
                </td>
                <td className="pt-2 text-right font-semibold tabular-nums">
                  {total.toFixed(2)} {draft.currency}
                </td>
              </tr>
            </tfoot>
          </table>
          <div className="flex gap-2">
            <button className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50" disabled={busy} onClick={() => create(true)}>
              Create and send via PayPal
            </button>
            <button className="rounded-lg border px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => create(false)}>
              Save as draft
            </button>
            <button className="px-2 text-slate-500" disabled={busy} onClick={() => setDraft(null)}>
              Back
            </button>
          </div>
        </div>
      )}
      {status.msg && (
        <p className={`mt-3 text-sm ${status.kind === 'error' ? 'text-red-700' : status.kind === 'done' ? 'text-green-700' : 'text-slate-600'}`}>
          {status.msg}
        </p>
      )}
    </section>
  );
}
