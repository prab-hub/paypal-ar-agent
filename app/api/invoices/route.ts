import { z } from 'zod';
import { createInvoice, deleteInvoice, listInvoices, PayPalError, sendInvoice } from '@/lib/paypal';
import { summarize, toRow } from '@/lib/ar';
import { limit } from '@/lib/ratelimit';

export async function GET() {
  try {
    const rows = (await listInvoices()).map((i) => toRow(i));
    return Response.json({ rows, summary: summarize(rows) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

const Body = z.object({
  customer_name: z.string(),
  customer_email: z.string().email(),
  currency: z.string().length(3),
  due_in_days: z.number().int().min(0).max(365),
  note: z.string().max(4000),
  po_number: z.string().max(22),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(1000),
        quantity: z.number().positive(),
        unit_price: z.number().positive(),
      }),
    )
    .min(1),
  send: z.boolean(),
});

export async function POST(req: Request) {
  const limited = limit(req);
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  }
  const d = parsed.data;
  const due = new Date(Date.now() + d.due_in_days * 86_400_000).toISOString().slice(0, 10);
  try {
    const inv = await createInvoice({
      detail: {
        currency_code: d.currency.toUpperCase(),
        note: d.note || undefined,
        reference: d.po_number || undefined,
        payment_term: { due_date: due },
      },
      primary_recipients: [
        {
          billing_info: {
            email_address: d.customer_email,
            ...(d.customer_name.trim() ? { business_name: d.customer_name.trim().slice(0, 100) } : {}),
          },
        },
      ],
      items: d.items.map((i) => ({
        name: i.name,
        description: i.description || undefined,
        quantity: String(i.quantity),
        unit_amount: { currency_code: d.currency.toUpperCase(), value: i.unit_price.toFixed(2) },
      })),
    });
    if (d.send) {
      try {
        await sendInvoice(inv.id);
      } catch (e) {
        // Don't leave a half-done draft behind when PayPal refuses to send (e.g. recipients in India are blocked).
        await deleteInvoice(inv.id).catch(() => {});
        const issue = e instanceof PayPalError ? (e.body as { details?: { description?: string }[] }).details?.[0]?.description : '';
        return Response.json({ error: `PayPal would not send this invoice. ${issue || (e as Error).message}` }, { status: 422 });
      }
    }
    return Response.json({ id: inv.id, number: inv.detail.invoice_number, sent: d.send });
  } catch (e) {
    const status = e instanceof PayPalError ? 422 : 502;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
