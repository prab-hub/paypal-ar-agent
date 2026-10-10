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
  memo: string;
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
    memo: inv.detail.memo ?? '',
  };
}

// Standard AR aging buckets by days past due. Not-yet-due balances sit in Current.
export const AGING = [
  { label: 'Current', min: -Infinity, max: 0 },
  { label: '1-30', min: 1, max: 30 },
  { label: '31-60', min: 31, max: 60 },
  { label: '61-90', min: 61, max: 90 },
  { label: '90+', min: 91, max: Infinity },
] as const;

export function summarize(rows: LedgerRow[], now = new Date()) {
  const open = rows.filter((r) => r.balance > 0);
  const overdue = open.filter((r) => (r.daysOverdue ?? -1) > 0);
  const sum = (xs: LedgerRow[]) => +xs.reduce((s, r) => s + r.balance, 0).toFixed(2);
  const aging = AGING.map((b) => {
    const xs = open.filter((r) => {
      const d = r.daysOverdue ?? 0;
      return d >= b.min && d <= b.max;
    });
    return { label: b.label, count: xs.length, amount: sum(xs) };
  });
  // DSO, the standard way: receivables now / credit sales over the last 90 days x 90.
  // Only one currency is meaningful; mixed-currency ledgers use the most common one.
  const live = rows.filter((r) => r.status !== 'DRAFT' && r.status !== 'CANCELLED');
  const cur = mode(live.map((r) => r.currency)) ?? 'USD';
  const billed90 = live
    .filter((r) => r.currency === cur && r.invoiceDate && daysBetween(r.invoiceDate, now) <= 90)
    .reduce((s, r) => s + r.total, 0);
  const ar = open.filter((r) => r.currency === cur).reduce((s, r) => s + r.balance, 0);
  return {
    currency: cur,
    openCount: open.length,
    openAmount: sum(open),
    overdueCount: overdue.length,
    overdueAmount: sum(overdue),
    paidCount: rows.filter((r) => r.status === 'PAID' || r.status === 'MARKED_AS_PAID').length,
    aging,
    dso: billed90 > 0 ? Math.round((ar / billed90) * 90) : null,
  };
}

function mode(xs: string[]): string | undefined {
  const c = new Map<string, number>();
  xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// Collections queue: which open invoices should get a reminder today, highest priority first.
// Rule: due within 3 days or overdue, and not reminded in the last 5 days. Priority weighs the balance by lateness,
// and an invoice the customer never opened ranks higher (it was probably missed, so a nudge works best).
export const REMIND_EVERY_DAYS = 5;

export type QueueItem = { row: LedgerRow; priority: number; why: string };

export function collectionsQueue(rows: LedgerRow[], reminded: Record<string, string>, now = new Date()): QueueItem[] {
  return rows
    .filter((r) => r.balance > 0 && r.daysOverdue !== null && r.daysOverdue >= -3)
    .filter((r) => !reminded[r.id] || daysBetween(reminded[r.id].slice(0, 10), now) >= REMIND_EVERY_DAYS)
    .map((r) => {
      const late = Math.max(0, r.daysOverdue ?? 0);
      const priority = Math.round(r.balance * (1 + late / 30) * (r.viewed ? 1 : 1.2));
      const why =
        (r.daysOverdue ?? 0) < 0 ? `Due in ${-(r.daysOverdue ?? 0)} days: friendly heads-up` :
        r.daysOverdue === 0 ? 'Due today' :
        `${late} days late, stage ${r.stage}` + (r.paid > 0 ? ', partly paid' : '') + (r.viewed ? '' : ', never opened');
      return { row: r, priority, why };
    })
    .sort((a, b) => b.priority - a.priority);
}
