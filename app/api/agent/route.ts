import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { model } from '@/lib/model';
import { z } from 'zod';
import { paypalTools, READ_ONLY } from '@/lib/agent-tools';
import { buildRevRecInputs } from '@/lib/revrec-classify';
import { waterfall } from '@/lib/revrec';
import { limit } from '@/lib/ratelimit';
import { reconcile } from '@/lib/reconcile';
import { listInvoices } from '@/lib/paypal';
import { collectionsQueue, summarize, toRow } from '@/lib/ar';
import { remindedMap } from '@/lib/reminded';

// Our own read-only tool next to the PayPal toolkit: the ASC 606 schedule built from live invoices.
const revenueSchedule = tool({
  description:
    'Revenue recognition (ASC 606) built from PayPal invoices: per-month billed, collected, recognized, deferred and ' +
    'unbilled revenue, plus how each invoice line is recognized (point in time or over a service period) and why.',
  inputSchema: z.object({}),
  execute: async () => {
    const d = await buildRevRecInputs();
    return {
      months: waterfall(d.obligations, d.billed, d.collected),
      obligations: d.obligations.map(({ invoiceNumber, customer, item, amount, currency, method, start, end, rationale }) => ({
        invoiceNumber, customer, item, amount, currency, method, start, end: method === 'ratable' ? end : undefined, rationale,
      })),
      skipped_other_currencies: d.skipped,
    };
  },
});

// Our own read-only tools built on the same code as the dashboard, so the agent and the screen agree.
const arSummary = tool({
  description:
    'AR health from PayPal invoices: outstanding and overdue totals, aging buckets (Current, 1-30, 31-60, 61-90, 90+), ' +
    'DSO, and today\'s collections queue (which invoices should get a reminder, highest priority first, and why).',
  inputSchema: z.object({}),
  execute: async () => {
    const rows = (await listInvoices()).filter((i) => i.status !== 'CANCELLED').map((i) => toRow(i));
    const queue = collectionsQueue(rows, remindedMap()).map(({ row, priority, why }) => ({
      invoice_id: row.id, number: row.number, customer: row.customer, balance: row.balance, currency: row.currency, days_overdue: row.daysOverdue, priority, why,
    }));
    return { ...summarize(rows), collections_queue: queue };
  },
});

const reconciliation = tool({
  description:
    'Cash reconciliation: each paid or partly paid invoice matched to its payments, with PayPal fees, net amount, ' +
    'remaining balance and a status (matched, short_pay, partial), plus PayPal receipts not tied to any invoice.',
  inputSchema: z.object({}),
  execute: async () => reconcile(),
});

const OWN_READ_TOOLS = new Set(['get_revenue_schedule', 'get_ar_summary', 'get_reconciliation']);

export const maxDuration = 120;

const SYSTEM = `You are the accounts receivable agent for a small business that bills its customers with PayPal invoices.
Today is ${new Date().toISOString().slice(0, 10)}.

You can read invoices, transactions, disputes and merchant insights, and you can create, send, remind, cancel and
record payments on invoices. Every action that changes money or what the customer sees needs the user's approval,
which the app asks for automatically: just call the tool.

How to work:
- Before acting, look up the facts (list or search invoices, get the invoice). Never guess invoice ids or amounts.
- When asked who owes money, report invoice number, customer, balance, due date and days overdue, oldest first.
- Collections reminders escalate with lateness: friendly before due, neutral 1-7 days late, direct 8-30 days
  (ask for a payment date), calm final notice after 30 days offering a payment plan. PayPal adds the Pay Now button,
  so never paste payment links or bank details. Never threaten legal action.
- For revenue questions (recognized, deferred, unbilled, "how much did we earn in October"), call
  get_revenue_schedule. Explain that revenue follows delivery, not invoicing or payment.
- For AR health, aging, DSO, or "who should I chase today", call get_ar_summary.
- For reconciliation (fees, short pays, unapplied cash), call get_reconciliation. A short pay is a small gap after
  payment (bank or FX charges); a partial payment is a real balance still owed.
- For disputes, list them, then explain the reason, the amount and the respond-by date. The Disputes tab drafts evidence.
- Keep answers short and concrete. Use plain text or simple lists. Never use em dashes.`;

export async function POST(req: Request) {
  const limited = limit(req);
  if (limited) return limited;
  const { messages }: { messages: UIMessage[] } = await req.json();
  const result = streamText({
    model,
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools: { ...paypalTools(), get_revenue_schedule: revenueSchedule, get_ar_summary: arSummary, get_reconciliation: reconciliation },
    toolApproval: ({ toolCall }) =>
      READ_ONLY.has(toolCall.toolName) || OWN_READ_TOOLS.has(toolCall.toolName) ? 'not-applicable' : 'user-approval',
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
    stopWhen: isStepCount(12),
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
