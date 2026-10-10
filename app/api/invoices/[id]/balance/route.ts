import { createInvoice, getInvoice, recordPayment, sendInvoice } from '@/lib/paypal';
import { toRow } from '@/lib/ar';
import { limit } from '@/lib/ratelimit';
import { MOVED_PREFIX } from '@/lib/reconcile';

// Short pay: bill the remaining balance on a new invoice and close the original by moving the balance across.
// The user clicks this button explicitly, which is the approval.
export async function POST(req: Request, ctx: RouteContext<'/api/invoices/[id]/balance'>) {
  const limited = limit(req);
  if (limited) return limited;
  const { id } = await ctx.params;
  try {
    const inv = await getInvoice(id);
    const row = toRow(inv);
    const due = Number(inv.due_amount?.value ?? 0);
    if (inv.status !== 'PARTIALLY_PAID' || due <= 0) {
      return Response.json({ error: 'Only a partially paid invoice has a balance to move.' }, { status: 400 });
    }
    const today = new Date().toISOString().slice(0, 10);
    const r = inv.primary_recipients?.[0]?.billing_info;
    const next = await createInvoice({
      detail: {
        currency_code: row.currency,
        note: `Remaining balance of invoice ${row.number}. The earlier payment arrived ${due.toFixed(2)} ${row.currency} short.`,
        reference: `BAL-${row.number}`.slice(0, 22),
        payment_term: { due_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) },
        ...(inv.detail.memo ? { memo: inv.detail.memo } : {}),
      },
      primary_recipients: [{ billing_info: { email_address: r?.email_address, ...(r?.business_name ? { business_name: r.business_name } : {}) } }],
      items: [{ name: `Balance of invoice ${row.number}`, quantity: '1', unit_amount: { currency_code: row.currency, value: due.toFixed(2) } }],
    });
    await sendInvoice(next.id);
    await recordPayment(id, {
      method: 'OTHER',
      date: today,
      amount: { currency_code: row.currency, value: due.toFixed(2) },
      note: `${MOVED_PREFIX} ${next.detail.invoice_number}`,
    });
    return Response.json({ ok: true, number: next.detail.invoice_number });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
