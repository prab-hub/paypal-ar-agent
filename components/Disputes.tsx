'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DisputeView, Recommendation } from '@/lib/disputes';
import { money } from '@/lib/format';

const ACTION: Record<Recommendation['action'], string> = {
  accept: 'Accept the claim',
  offer_refund: 'Offer a partial refund',
  contest: 'Contest with evidence',
};

function Desk({ d, onDone }: { d: DisputeView; onDone: () => void }) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [msg, setMsg] = useState('AI is reviewing the dispute and the invoice behind it...');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    fetch(`/api/disputes/${d.id}`)
      .then(async (r) => ({ ok: r.ok, j: await r.json() }))
      .then(({ ok, j }) => {
        setBusy(false);
        if (!ok) return setMsg(j.error);
        setRec(j.recommendation);
        setMsg('');
      });
  }, [d.id]);

  async function act(body: object, label: string) {
    if (!confirm(`${label}? This goes to PayPal and the buyer.`)) return;
    setBusy(true);
    const res = await fetch(`/api/disputes/${d.id}`, { method: 'POST', body: JSON.stringify(body) });
    const j = await res.json();
    setBusy(false);
    setMsg(res.ok ? `${label}: done.` : j.error);
    if (res.ok) onDone();
  }

  if (!rec) return <p className="mt-3 text-sm text-slate-600">{msg}</p>;
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="rounded-lg bg-slate-50 p-3">
        <div className="font-medium">
          AI recommends: {ACTION[rec.action]}
          {rec.action === 'offer_refund' && ` of ${money(rec.refund_amount, d.currency)}`}{' '}
          <span className="text-xs font-normal text-slate-500">({rec.confidence} confidence)</span>
        </div>
        <ul className="mt-1 list-disc pl-5 text-slate-700">
          {rec.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
      {rec.evidence.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence pack (editable)</div>
          {rec.evidence.map((e, i) => (
            <label key={i} className="mt-2 block">
              <span className="text-xs text-slate-500">{e.evidence_type.replaceAll('_', ' ').toLowerCase()}</span>
              <textarea className="mt-1 h-20 w-full rounded border border-slate-300 p-2" value={e.notes}
                onChange={(ev) => setRec({ ...rec, evidence: rec.evidence.map((x, j) => (j === i ? { ...x, notes: ev.target.value } : x)) })} />
            </label>
          ))}
        </div>
      )}
      {rec.missing.length > 0 && <p className="text-xs text-slate-600">Attach in PayPal if you have them: {rec.missing.join('; ')}.</p>}
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Message to buyer</span>
        <textarea className="mt-1 h-24 w-full rounded border border-slate-300 p-2" value={rec.message_to_buyer} onChange={(e) => setRec({ ...rec, message_to_buyer: e.target.value })} />
      </label>
      <div className="flex flex-wrap gap-2">
        {d.canRespond && (
          <button className="rounded-lg bg-blue-700 px-3 py-2 font-medium text-white disabled:opacity-50" disabled={busy || !rec.evidence.length}
            onClick={() => act({ action: 'contest', evidence: rec.evidence }, 'Submit evidence')}>Submit evidence</button>
        )}
        <button className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50" disabled={busy}
          onClick={() => act({ action: 'offer_refund', note: rec.message_to_buyer, amount: rec.refund_amount || d.amount }, `Offer ${money(rec.refund_amount || d.amount, d.currency)} refund`)}>Offer refund</button>
        {d.canAccept && (
          <button className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50" disabled={busy}
            onClick={() => act({ action: 'accept', note: rec.message_to_buyer }, 'Accept the claim')}>Accept claim</button>
        )}
        <button className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50" disabled={busy}
          onClick={() => act({ action: 'message', note: rec.message_to_buyer }, 'Send message')}>Send message only</button>
      </div>
      {msg && <p className="text-slate-700">{msg}</p>}
    </div>
  );
}

export default function Disputes() {
  const [list, setList] = useState<DisputeView[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');

  const load = useCallback(() => {
    fetch('/api/disputes')
      .then(async (r) => ({ ok: r.ok, j: await r.json() }))
      .then(({ ok, j }) => (ok ? setList(j.disputes) : setError(j.error)));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Disputes</h2>
        <button className="text-sm text-blue-700 hover:underline" onClick={load}>Refresh from PayPal</button>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        When a customer disputes an invoice payment, AI reads the claim and the invoice behind it, recommends accept,
        refund or contest, and drafts the evidence and the message. You decide and send.
      </p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {list && list.length === 0 && (
        <p className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">No open disputes on this PayPal account.</p>
      )}
      <ul className="mt-4 space-y-3">
        {list?.map((d) => (
          <li key={d.id} className="rounded-lg border border-slate-200 p-3">
            <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === d.id ? '' : d.id)}>
              <span>
                <span className="font-medium">{d.reason.replaceAll('_', ' ').toLowerCase()}</span>
                <span className="block text-xs text-slate-500">
                  {d.buyer} · opened {d.created} · {d.status.replaceAll('_', ' ').toLowerCase()}
                  {d.respondBy && ` · respond by ${d.respondBy}`}
                </span>
              </span>
              <span className="font-semibold tabular-nums">{money(d.amount, d.currency)}</span>
            </button>
            {open === d.id && <Desk d={d} onDone={load} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
