// Dispute desk: find the invoice behind a PayPal dispute, have AI recommend accept / refund offer / contest,
// and draft the evidence and the message. A human sends whatever is chosen.
import 'server-only';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { judgmentModel } from './model';
import { getDispute, getInvoice, listDisputes, listInvoices, type PPDispute, type PPInvoice } from './paypal';
import { toRow } from './ar';

// The PayPal evidence types that fit a service business invoicing through PayPal.
export const EVIDENCE_TYPES = [
  'PROOF_OF_FULFILLMENT',
  'COPY_OF_CONTRACT',
  'ITEM_DESCRIPTION',
  'PROOF_OF_REFUND',
  'PAID_WITH_OTHER_METHOD',
  'OTHER',
] as const;

export const RecommendationSchema = z.object({
  action: z.enum(['accept', 'offer_refund', 'contest']),
  confidence: z.enum(['low', 'medium', 'high']),
  refund_amount: z.number().describe('Partial refund to offer when action is offer_refund, else 0'),
  reasons: z.array(z.string()).describe('2 to 4 short reasons a business owner can check'),
  evidence: z
    .array(z.object({ evidence_type: z.enum(EVIDENCE_TYPES), notes: z.string().describe('What this evidence shows, under 500 characters') }))
    .describe('Evidence to submit if contesting; empty otherwise'),
  missing: z.array(z.string()).describe('Documents the owner should attach in PayPal that we cannot see (signed SOW, delivery emails)'),
  message_to_buyer: z.string().describe('Calm, factual message to the buyer, under 600 characters, no em dashes'),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

export type DisputeView = {
  id: string;
  reason: string;
  status: string;
  stage: string;
  amount: number;
  currency: string;
  created: string;
  respondBy: string;
  buyer: string;
  invoice: { id: string; number: string; customer: string; total: number; paid: number; invoiceDate: string; items: string[] } | null;
  canRespond: boolean;
  canAccept: boolean;
};

const hasLink = (d: PPDispute, rel: string) => !!d.links?.some((l) => l.rel === rel);

type InvoiceSummary = Awaited<ReturnType<typeof listInvoices>>[number];

function matchInvoice(d: PPDispute, all: InvoiceSummary[]): InvoiceSummary | undefined {
  const tx = d.disputed_transactions?.[0];
  if (!tx) return undefined;
  // PayPal puts the invoice ID (INV2-...) in invoice_number for invoice payments; older or manual disputes may carry
  // the human invoice number instead. Fallback: same buyer email and the invoice total equals the disputed amount.
  const ref = tx.invoice_number;
  let hit = ref ? all.find((i) => i.id === ref) ?? all.find((i) => i.detail.invoice_number === ref) : undefined;
  if (!hit && tx.buyer?.email) {
    const amt = Number(tx.gross_amount?.value ?? d.dispute_amount?.value ?? 0);
    hit = all.find(
      (i) =>
        i.primary_recipients?.[0]?.billing_info?.email_address?.toLowerCase() === tx.buyer?.email?.toLowerCase() &&
        Math.abs(Number(i.amount?.value ?? 0) - amt) < 0.01,
    );
  }
  return hit;
}

async function findInvoice(d: PPDispute, all?: InvoiceSummary[]): Promise<PPInvoice | null> {
  const hit = matchInvoice(d, all ?? (await listInvoices()));
  return hit ? getInvoice(hit.id) : null;
}

export function view(d: PPDispute, inv: PPInvoice | null): DisputeView {
  const tx = d.disputed_transactions?.[0];
  const row = inv ? toRow(inv) : null;
  return {
    id: d.dispute_id,
    reason: d.reason ?? '',
    status: d.status ?? '',
    stage: d.dispute_life_cycle_stage ?? '',
    amount: Number(d.dispute_amount?.value ?? 0),
    currency: d.dispute_amount?.currency_code ?? '',
    created: (d.create_time ?? '').slice(0, 10),
    respondBy: (d.seller_response_due_date ?? '').slice(0, 10),
    buyer: tx?.buyer?.name || tx?.buyer?.email || '',
    invoice: row && inv
      ? { id: inv.id, number: row.number, customer: row.customer, total: row.total, paid: row.paid, invoiceDate: row.invoiceDate, items: (inv.items ?? []).map((i) => i.name) }
      : null,
    canRespond: hasLink(d, 'provide_evidence'),
    canAccept: hasLink(d, 'accept_claim'),
  };
}

export async function analyzeDispute(id: string): Promise<{ dispute: DisputeView; recommendation: Recommendation }> {
  const d = await getDispute(id);
  const inv = await findInvoice(d);
  const v = view(d, inv);
  const facts = {
    dispute: {
      reason: v.reason,
      status: v.status,
      stage: v.stage,
      amount: `${v.amount.toFixed(2)} ${v.currency}`,
      opened: v.created,
      respond_by: v.respondBy,
      buyer_messages: (d.messages ?? []).map((m) => `${m.posted_by}: ${m.content}`).slice(-6),
    },
    invoice: inv
      ? {
          number: v.invoice?.number,
          date: v.invoice?.invoiceDate,
          note: inv.detail.note,
          reference: (inv.detail as { reference?: string }).reference,
          lines: (inv.items ?? []).map((i) => ({ name: i.name, description: i.description, qty: i.quantity, unit: i.unit_amount.value })),
          total: v.invoice?.total,
          payments: (inv.payments?.transactions ?? []).map((t) => ({ date: t.payment_date, amount: t.amount?.value, method: t.method })),
          customer_opened_invoice: !!inv.detail.viewed_by_recipient,
        }
      : 'No matching invoice found',
  };
  const { output } = await generateText({
    model: judgmentModel,
    output: Output.object({ schema: RecommendationSchema }),
    system:
      'You help a small service business respond to a PayPal dispute on an invoice payment. Recommend one action. ' +
      'contest when the invoice shows the work was agreed and delivered and the reason does not hold (e.g. ' +
      'MERCHANDISE_OR_SERVICE_NOT_RECEIVED on a delivered build). offer_refund when part of the claim is fair ' +
      '(e.g. one line not delivered): refund just that part. accept when the amount is small relative to the cost ' +
      'of fighting, the claim looks fair, or there is no invoice to back the charge. UNAUTHORISED claims are about ' +
      'the payer account, not the work: contest only with proof the customer authorized it. Be honest about ' +
      'confidence. Evidence notes must only state facts present in the data. Never use em dashes.',
    prompt: JSON.stringify(facts, null, 2),
  });
  return { dispute: v, recommendation: output };
}

export async function listDisputeViews(): Promise<DisputeView[]> {
  const items = await listDisputes();
  if (items.length === 0) return [];
  const all = await listInvoices();
  // The list endpoint returns a summary; read each one for amounts, buyer, available actions and its invoice.
  return Promise.all(
    items.slice(0, 20).map(async (s) => {
      const d = await getDispute(s.dispute_id);
      return view(d, await findInvoice(d, all).catch(() => null));
    }),
  );
}
