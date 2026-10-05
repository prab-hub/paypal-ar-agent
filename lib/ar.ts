// AR ledger rows and collection stages, computed from PayPal invoices. Pure functions, safe on client and server.
import type { PPInvoice } from './paypal';

export type Stage = { id: number; label: string; range: [number, number] };

// Same escalation ladder as the RevExOS AR collection email generator.
export const STAGES: Stage[] = [
  { id: 1, label: 'Pre-due', range: [-3, -1] },
  { id: 2, label: 'Due today', range: [0, 0] },
  { id: 3, label: 'Just late', range: [1, 7] },
  { id: 4, label: 'Follow-up', range: [8, 14] },
  { id: 5, label: 'Firm', range: [15, 30] },
  { id: 6, label: 'Final', range: [31, Infinity] },
];

export function stageFor(daysOverdue: number | null): Stage | null {
  if (daysOverdue === null) return null;
  return STAGES.find((s) => daysOverdue >= s.range[0] && daysOverdue <= s.range[1]) ?? null;
}

export type LedgerRow = {
  id: string;
  number: string;
  customer: string;
  email: string;
  status: string;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  invoiceDate: string;
  dueDate: string;
  daysOverdue: number | null;
  stage: string;
  viewed: boolean;
};

const OPEN = new Set(['SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED']);

export function daysBetween(fromIso: string, to = new Date()): number {
  const from = new Date(fromIso + 'T00:00:00Z');
  const today = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((today - from.getTime()) / 86_400_000);
}

export function toRow(inv: PPInvoice, now = new Date()): LedgerRow {
  const r = inv.primary_recipients?.[0]?.billing_info;
  const name = r?.business_name || r?.name?.full_name || [r?.name?.given_name, r?.name?.surname].filter(Boolean).join(' ');
  const total = Number(inv.amount?.value ?? 0);
  const balance = inv.due_amount ? Number(inv.due_amount.value) : OPEN.has(inv.status) ? total : 0;
  const due = inv.detail.payment_term?.due_date ?? '';
  const open = OPEN.has(inv.status);
  const daysOverdue = open && due ? daysBetween(due, now) : null;
  return {
    id: inv.id,
    number: inv.detail.invoice_number ?? '',
    customer: name || r?.email_address || '',
    email: r?.email_address ?? '',
    status: inv.status,
    currency: inv.detail.currency_code,
    total,
    paid: Math.max(0, +(total - balance).toFixed(2)),
    balance: open ? balance : 0,
    invoiceDate: inv.detail.invoice_date ?? '',
    dueDate: due,
    daysOverdue,
    stage: stageFor(daysOverdue)?.label ?? '',
    viewed: !!inv.detail.viewed_by_recipient,
  };
}

export function summarize(rows: LedgerRow[]) {
  const open = rows.filter((r) => r.balance > 0);
  const overdue = open.filter((r) => (r.daysOverdue ?? -1) > 0);
  const sum = (xs: LedgerRow[]) => +xs.reduce((s, r) => s + r.balance, 0).toFixed(2);
  return {
    openCount: open.length,
    openAmount: sum(open),
    overdueCount: overdue.length,
    overdueAmount: sum(overdue),
    paidCount: rows.filter((r) => r.status === 'PAID' || r.status === 'MARKED_AS_PAID').length,
  };
}
