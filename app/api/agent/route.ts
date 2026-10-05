import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { model } from '@/lib/model';
import { paypalTools, READ_ONLY } from '@/lib/agent-tools';

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
- For reconciliation, compare invoice amounts with transactions and call out short pays, overpays and fees.
- Keep answers short and concrete. Use plain text or simple lists. Never use em dashes.`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const result = streamText({
    model,
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools: paypalTools(),
    toolApproval: ({ toolCall }) => (READ_ONLY.has(toolCall.toolName) ? 'not-applicable' : 'user-approval'),
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
    stopWhen: isStepCount(12),
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
