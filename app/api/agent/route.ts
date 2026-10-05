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
- For reconciliation, compare invoice amounts with transactions and call out short pays, overpays and fees.
- Keep answers short and concrete. Use plain text or simple lists. Never use em dashes.`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const result = streamText({
    model,
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools: { ...paypalTools(), get_revenue_schedule: revenueSchedule },
    toolApproval: ({ toolCall }) =>
      READ_ONLY.has(toolCall.toolName) || toolCall.toolName === 'get_revenue_schedule' ? 'not-applicable' : 'user-approval',
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
    stopWhen: isStepCount(12),
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
