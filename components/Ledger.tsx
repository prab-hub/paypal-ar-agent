'use client';

import { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import type { LedgerRow, summarize } from '@/lib/ar';

ModuleRegistry.registerModules([AllCommunityModule]);

type Summary = ReturnType<typeof summarize>;
type Reminder = { subject: string; note: string; tone: string; reasoning: string };

const money = (v: number, c = '') => `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${c ? ' ' + c : ''}`;

export default function Ledger({ rows, summary, loading, onRefresh }: { rows: LedgerRow[]; summary: Summary | null; loading: boolean; onRefresh: () => void }) {
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const cols = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: 'number', headerName: 'Invoice', width: 100 },
      { field: 'customer', flex: 1, minWidth: 160 },
      { field: 'status', width: 130 },
      { field: 'total', width: 110, type: 'rightAligned', valueFormatter: (p) => money(p.value) },
      { field: 'balance', width: 110, type: 'rightAligned', valueFormatter: (p) => money(p.value) },
      { field: 'currency', headerName: 'Cur', width: 70 },
      { field: 'dueDate', headerName: 'Due', width: 115 },
      {
        field: 'daysOverdue',
        headerName: 'Days late',
        width: 105,
        type: 'rightAligned',
        cellStyle: (p) => ((p.value ?? 0) > 14 ? { color: '#b91c1c', fontWeight: 600 } : (p.value ?? 0) > 0 ? { color: '#b45309', fontWeight: 400 } : null),
      },
      { field: 'stage', width: 110 },
      { field: 'viewed', headerName: 'Opened', width: 90, valueFormatter: (p) => (p.value ? 'yes' : 'no') },
    ],
    [],
  );

  async function draft(row: LedgerRow) {
    setSelected(row);
    setReminder(null);
    setMsg('AI is drafting a reminder...');
    setBusy(true);
    const res = await fetch(`/api/invoices/${row.id}/remind`);
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(d.error);
    setReminder(d);
    setMsg('');
  }

  async function send() {
    if (!selected || !reminder) return;
    setBusy(true);
    const res = await fetch(`/api/invoices/${selected.id}/remind`, { method: 'POST', body: JSON.stringify(reminder) });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(d.error);
    setMsg(`Reminder sent to ${selected.email} through PayPal.`);
    setReminder(null);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">2. Receivables</h2>
        <button className="text-sm text-blue-700 hover:underline" onClick={onRefresh} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh from PayPal'}
        </button>
      </div>
      {summary && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Open invoices', String(summary.openCount)],
            ['Outstanding', money(summary.openAmount)],
            ['Overdue', String(summary.overdueCount)],
            ['Overdue amount', money(summary.overdueAmount)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">{k}</div>
              <div className="text-xl font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 h-80">
        <AgGridReact<LedgerRow>
          theme={themeQuartz}
          rowData={rows}
          columnDefs={cols}
          getRowId={(p) => p.data.id}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          onRowClicked={(e) => e.data && e.data.balance > 0 && draft(e.data)}
          overlayNoRowsTemplate="No invoices yet. Create one above."
        />
      </div>
      <p className="mt-2 text-xs text-gray-500">Click an unpaid invoice to have AI draft a collection reminder.</p>

      {selected && (reminder || msg) && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
          <div className="font-medium">
            Reminder for invoice {selected.number}, {selected.customer} ({money(selected.balance, selected.currency)},{' '}
            {selected.daysOverdue === null ? 'no due date' : selected.daysOverdue > 0 ? `${selected.daysOverdue} days late` : `due in ${-selected.daysOverdue} days`})
          </div>
          {reminder && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-gray-600">
                Tone: <b>{reminder.tone}</b>. {reminder.reasoning}
              </p>
              <input className="w-full rounded border bg-white p-2" value={reminder.subject} onChange={(e) => setReminder({ ...reminder, subject: e.target.value })} />
              <textarea className="h-40 w-full rounded border bg-white p-2" value={reminder.note} onChange={(e) => setReminder({ ...reminder, note: e.target.value })} />
              <div className="flex gap-2">
                <button className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50" disabled={busy} onClick={send}>
                  Send reminder via PayPal
                </button>
                <button className="rounded-lg border bg-white px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => draft(selected)}>
                  Redraft
                </button>
              </div>
            </div>
          )}
          {msg && <p className="mt-2">{msg}</p>}
        </div>
      )}
    </section>
  );
}
