'use client';

import { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import type { LedgerRow } from '@/lib/ar';
import { money } from '@/lib/format';
import ReminderEditor from './ReminderEditor';

ModuleRegistry.registerModules([AllCommunityModule]);

const STATUS: Record<string, string> = {
  PAID: 'text-emerald-700',
  MARKED_AS_PAID: 'text-emerald-700',
  PARTIALLY_PAID: 'text-amber-700',
  DRAFT: 'text-slate-400',
};

export default function Ledger({ rows, loading, onRefresh }: { rows: LedgerRow[]; loading: boolean; onRefresh: () => void }) {
  const [selected, setSelected] = useState<LedgerRow | null>(null);

  const cols = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: 'number', headerName: 'Invoice', width: 95, sort: 'desc' },
      { field: 'customer', flex: 1, minWidth: 160 },
      { field: 'status', width: 140, cellClass: (p) => STATUS[p.value] ?? '', valueFormatter: (p) => String(p.value).replaceAll('_', ' ').toLowerCase() },
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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Receivables</h2>
        <button className="text-sm text-blue-700 hover:underline" onClick={onRefresh} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh from PayPal'}
        </button>
      </div>
      <div className="mt-3 h-96">
        <AgGridReact<LedgerRow>
          theme={themeQuartz}
          rowData={rows}
          columnDefs={cols}
          getRowId={(p) => p.data.id}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          onRowClicked={(e) => e.data && e.data.balance > 0 && setSelected(e.data)}
          overlayNoRowsTemplate="No invoices yet. Create one above, or load the demo data."
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">Click an unpaid invoice to have AI draft a collection reminder.</p>
      {selected && (
        <div className="mt-4">
          <ReminderEditor key={selected.id} row={selected} onSent={onRefresh} />
        </div>
      )}
    </section>
  );
}
