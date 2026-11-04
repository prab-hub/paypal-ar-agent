// Cash reconciliation: every payment PayPal knows about, matched to its invoice, with fees and differences.
// Rules are deterministic on purpose: an accountant needs the same answer every time.
import 'server-only';
import { getCapture, getInvoice, listInvoices, listTransactions, PayPalError, type PPInvoice } from './paypal';
import { toRow } from './ar';

export type RecStatus = 'matched' | 'short_pay' | 'partial' | 'unapplied';

export type RecPayment = { id: string; date: string; method: string; type: string; gross: number; fee: number | null; net: number | null; note: string; held: boolean };

export type RecRow = {
  invoiceId: string;
  number: string;
  customer: string;
  currency: string;
  total: number;
  received: number;
  fees: number;
  net: number;
  balance: number;
  status: RecStatus;
  explanation: string;
  payments: RecPayment[];
};

// A remaining balance this small, after the customer has paid, is almost always a bank charge or FX deduction
// rather than a customer who intends to pay later.
const SHORT_PAY_MAX = { pct: 0.05, abs: 100 };

export const MOVED_PREFIX = 'Balance moved to invoice';

const r2 = (n: number) => Math.round(n * 100) / 100;

async function paymentsFor(inv: PPInvoice): Promise<RecPayment[]> {
  return Promise.all(
    (inv.payments?.transactions ?? []).map(async (t) => {
      const gross = Number(t.amount?.value ?? 0);
      let fee: number | null = null;
      let net: number | null = null;
      let held = false;
      // PayPal checkout payments have a capture with the fee; recorded cash/bank payments don't.
      if (t.type !== 'EXTERNAL' && t.payment_id) {
        try {
          const cap = await getCapture(t.payment_id);
          const b = cap.seller_receivable_breakdown;
          // A capture PayPal is holding (status PENDING, e.g. after a buyer complaint) has no fee breakdown yet:
          // leave fee and net unknown instead of reporting a zero fee.
          held = cap.status === 'PENDING';
          if (b) {
            fee = Number(b.paypal_fee?.value ?? 0);
            net = Number(b.net_amount?.value ?? gross - fee);
          }
        } catch {
          // Capture not readable (different id shape or permissions): show the gross only.
        }
      }
      return {
        id: t.payment_id ?? t.transaction_id ?? '',
        date: (t.payment_date ?? '').slice(0, 10),
        method: t.method ?? '',
        type: t.type ?? '',
        gross,
        fee,
        net: net ?? (t.type === 'EXTERNAL' ? gross : null),
        note: t.note ?? '',
        held,
      };
    }),
  );
}

export async function reconcile(): Promise<{ rows: RecRow[]; transactionSearch: 'ok' | 'not_enabled' | 'error'; unapplied: RecRow[] }> {
  const list = (await listInvoices()).filter((i) => ['PAID', 'MARKED_AS_PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'].includes(i.status));
  const invoices = await Promise.all(list.map((i) => getInvoice(i.id)));

  const rows: RecRow[] = await Promise.all(
    invoices.map(async (inv) => {
      const row = toRow(inv);
      const all = await paymentsFor(inv);
      // "Invoice the balance" closes a short pay with a bookkeeping entry, not cash: keep it out of received.
      const moved = all.filter((p) => p.method === 'OTHER' && p.note.startsWith(MOVED_PREFIX));
      const payments = all.filter((p) => !moved.includes(p));
      const received = r2(payments.reduce((s, p) => s + p.gross, 0));
      const movedAmount = r2(moved.reduce((s, p) => s + p.gross, 0));
      const fees = r2(payments.reduce((s, p) => s + (p.fee ?? 0), 0));
      const balance = r2(Math.max(0, row.total - received - movedAmount));
      const small = balance > 0 && (balance <= row.total * SHORT_PAY_MAX.pct || balance <= SHORT_PAY_MAX.abs);
      const status: RecStatus = balance === 0 ? 'matched' : small ? 'short_pay' : 'partial';
      const explanation =
        status === 'matched' && movedAmount > 0
          ? `Short by ${movedAmount.toFixed(2)}; ${moved[0].note.charAt(0).toLowerCase()}${moved[0].note.slice(1)}.`
          : status === 'matched'
          ? fees > 0
            ? `Paid in full. PayPal kept ${fees.toFixed(2)} in fees; book them as an expense, not a short pay.`
            : 'Paid in full.'
          : status === 'short_pay'
            ? `Paid ${received.toFixed(2)} of ${row.total.toFixed(2)}. The ${balance.toFixed(2)} gap looks like a bank or FX deduction: invoice the balance or write it off.`
            : `Partial payment: ${balance.toFixed(2)} still owed. Keep it in collections.`;
      const heldAmount = r2(payments.filter((p) => p.held).reduce((s, p) => s + p.gross, 0));
      const heldNote = heldAmount > 0
        ? ` PayPal is holding ${heldAmount.toFixed(2)} of it while a buyer complaint is open; the fee shows once it is released.`
        : '';
      return {
        invoiceId: inv.id,
        number: row.number,
        customer: row.customer,
        currency: row.currency,
        total: row.total,
        received,
        fees,
        net: r2(received - fees),
        balance,
        status,
        explanation: explanation + heldNote,
        payments,
      };
    }),
  );

  // Payments that landed in PayPal but aren't tied to any invoice (needs Transaction Search on the app).
  let transactionSearch: 'ok' | 'not_enabled' | 'error' = 'ok';
  const unapplied: RecRow[] = [];
  try {
    const known = new Set(rows.flatMap((r) => r.payments.map((p) => p.id)));
    for (const t of await listTransactions(31)) {
      const ti = t.transaction_info;
      const amount = Number(ti.transaction_amount?.value ?? 0);
      // T00xx are incoming payments. Skip ones already linked to an invoice.
      if (amount <= 0 || !ti.transaction_event_code?.startsWith('T00') || known.has(ti.transaction_id) || ti.invoice_id) continue;
      const fee = Math.abs(Number(ti.fee_amount?.value ?? 0));
      unapplied.push({
        invoiceId: '',
        number: '',
        customer: t.payer_info?.payer_name?.alternate_full_name || t.payer_info?.email_address || 'Unknown payer',
        currency: ti.transaction_amount?.currency_code ?? '',
        total: 0,
        received: amount,
        fees: fee,
        net: r2(amount - fee),
        balance: 0,
        status: 'unapplied',
        explanation: 'Money received with no invoice attached. Match it to an open invoice or refund it.',
        payments: [{ id: ti.transaction_id, date: (ti.transaction_initiation_date ?? '').slice(0, 10), method: 'PAYPAL', type: 'PAYPAL', gross: amount, fee, net: r2(amount - fee), note: '', held: false }],
      });
    }
  } catch (e) {
    transactionSearch = e instanceof PayPalError && (e.status === 403 || e.status === 401) ? 'not_enabled' : 'error';
  }

  const order: Record<RecStatus, number> = { short_pay: 0, partial: 1, unapplied: 2, matched: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.number.localeCompare(b.number));
  return { rows, transactionSearch, unapplied };
}
