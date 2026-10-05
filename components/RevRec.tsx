'use client';

import { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { monthLabel, scheduleCsv, waterfall, type CashEvent, type Method, type Obligation } from '@/lib/revrec';

ModuleRegistry.registerModules([AllCommunityModule]);

const money = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Data = { obligations: Obligation[]; billed: CashEvent[]; collected: CashEvent[]; skipped: string[] };

export default function RevRec() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function build() {
    setBusy(true);
    setError('');
    const res = await fetch('/api/revrec');
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setError(d.error);
    setData(d);
  }

  const rows = useMemo(() => (data ? waterfall(data.obligations, data.billed, data.collected) : []), [data]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const now = rows.filter((r) => r.month <= thisMonth).at(-1);
  const currency = data?.obligations[0]?.currency ?? '';

  const cols = useMemo<ColDef<Obligation>[]>(
    () => [
      { field: 'invoiceNumber', headerName: 'Invoice', width: 95 },
      { field: 'customer', width: 150 },
      { field: 'item', flex: 1, minWidth: 180 },
      { field: 'amount', width: 105, type: 'rightAligned', valueFormatter: (p) => money(p.value) },
      {
        field: 'method',
        width: 140,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['point_in_time', 'ratable'] satisfies Method[] },
        valueFormatter: (p) => (p.value === 'ratable' ? 'Over time' : 'Point in time'),
        cellClass: 'cursor-pointer',
      },
      { field: 'start', headerName: 'Start / delivered', width: 135, editable: true },
      { field: 'end', headerName: 'End (excl.)', width: 115, editable: (p) => p.data?.method === 'ratable', valueFormatter: (p) => (p.data?.method === 'ratable' ? p.value : '') },
      { field: 'rationale', headerName: 'Why (AI)', flex: 1, minWidth: 220, tooltipField: 'rationale' },
    ],
    [],
  );

  function update(next: Obligation) {
    if (!data) return;
    if (!ISO.test(next.start) || (next.method === 'ratable' && (!ISO.test(next.end) || next.end <= next.start))) {
      setError('Dates must be yyyy-mm-dd and the end must be after the start.');
      return build(); // reload the AI values rather than keep a broken row
    }
    setError('');
    setData({ ...data, obligations: data.obligations.map((o) => (o.key === next.key ? { ...next, rationale: 'Edited by user' } : o)) });
  }

  function download() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([scheduleCsv(data.obligations)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'revenue-schedule.csv' });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">4. Revenue recognition</h2>
        <div className="flex gap-3 text-sm">
          {data && (
            <button className="text-blue-700 hover:underline" onClick={download}>
              Download schedule CSV
            </button>
          )}
          <button className="rounded-lg bg-blue-700 px-3 py-1.5 font-medium text-white disabled:opacity-50" onClick={build} disabled={busy}>
            {busy ? 'Classifying lines...' : data ? 'Rebuild from PayPal' : 'Build schedule from PayPal'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        ASC 606 / IFRS 15: revenue follows delivery, not the invoice or the payment. AI reads each PayPal invoice line and
        decides whether it is earned at a point in time or over a service period; you can change any line. Full months
        get equal amounts, partial months are split by their days.
      </p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [`Recognized ${monthLabel(thisMonth)}`, now?.month === thisMonth ? now.recognized : 0],
              ['Deferred revenue now', now?.deferred ?? 0],
              ['Unbilled revenue now', now?.unbilled ?? 0],
              ['Collected to date', rows.filter((r) => r.month <= thisMonth).reduce((s, r) => s + r.collected, 0)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-gray-50 p-3">
                <div className="text-xs text-gray-500">{k}</div>
                <div className="text-xl font-semibold tabular-nums">
                  {money(v as number)} <span className="text-xs font-normal text-gray-500">{currency}</span>
                </div>
              </div>
            ))}
          </div>

          <h3 className="mt-5 text-sm font-semibold">Performance obligations (one per invoice line, click Method or dates to edit)</h3>
          <div className="mt-2 h-72">
            <AgGridReact<Obligation>
              theme={themeQuartz}
              rowData={data.obligations}
              columnDefs={cols}
              getRowId={(p) => p.data.key}
              singleClickEdit
              onCellValueChanged={(e) => e.data && update(e.data)}
              tooltipShowDelay={300}
            />
          </div>

          <h3 className="mt-5 text-sm font-semibold">Monthly waterfall ({currency})</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm tabular-nums">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-1">Month</th>
                  <th className="text-right">Billed</th>
                  <th className="text-right">Collected</th>
                  <th className="text-right">Recognized</th>
                  <th className="text-right">Deferred (end)</th>
                  <th className="text-right">Unbilled (end)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month} className={`border-t ${r.month === thisMonth ? 'bg-blue-50' : ''}`}>
                    <td className="py-1">{monthLabel(r.month)}</td>
                    <td className="text-right">{money(r.billed)}</td>
                    <td className="text-right">{money(r.collected)}</td>
                    <td className="text-right font-medium">{money(r.recognized)}</td>
                    <td className="text-right">{money(r.deferred)}</td>
                    <td className="text-right">{money(r.unbilled)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Deferred revenue is billed ahead of delivery (a liability). Unbilled revenue is delivered but not yet invoiced (a
            contract asset). Billed excludes tax. Drafts and cancelled invoices are left out.
            {data.skipped.length > 0 && ` Other currencies not included: ${data.skipped.join(', ')}.`}
          </p>
        </>
      )}
    </section>
  );
}
