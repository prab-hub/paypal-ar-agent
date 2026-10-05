// AI-written collection reminder, tuned to how late the invoice is and whether the customer has opened it.
import 'server-only';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { model } from './model';
import { stageFor, toRow } from './ar';
import type { PPInvoice } from './paypal';

export const ReminderSchema = z.object({
  subject: z.string().describe('Email subject, under 80 characters'),
  note: z.string().describe('Reminder body, plain text, under 900 characters. No sign-off placeholders.'),
  tone: z.enum(['friendly', 'neutral', 'firm', 'final']),
  reasoning: z.string().describe('One sentence on why this tone, for the human reviewer'),
});

export type Reminder = z.infer<typeof ReminderSchema>;

export async function draftReminder(inv: PPInvoice, context = ''): Promise<Reminder> {
  const row = toRow(inv);
  const stage = stageFor(row.daysOverdue);
  const facts = {
    invoice_number: row.number,
    customer: row.customer,
    amount_due: `${row.balance.toFixed(2)} ${row.currency}`,
    total: `${row.total.toFixed(2)} ${row.currency}`,
    partially_paid: row.paid > 0,
    due_date: row.dueDate || 'not set',
    days_overdue: row.daysOverdue,
    stage: stage?.label ?? 'not yet due',
    customer_opened_invoice: row.viewed,
    items: inv.items?.map((i) => i.name),
  };
  const { output } = await generateText({
    model,
    output: Output.object({ schema: ReminderSchema }),
    system:
      'You write accounts receivable reminders for a small business. The reminder is sent through PayPal, which ' +
      'already includes the invoice and a Pay Now button, so do not paste links or bank details. Escalate tone by ' +
      'stage: Pre-due and Due today are friendly; Just late is neutral; Follow-up and Firm are direct and ask for a ' +
      'payment date; Final states consequences calmly (pause of work, standard terms) and offers a payment plan. ' +
      'If the customer never opened the invoice, assume it may have been missed rather than ignored. If partially ' +
      'paid, thank them and state the remaining balance. Never threaten legal action. Never use em dashes.',
    prompt: `Invoice facts:\n${JSON.stringify(facts, null, 2)}\n\nExtra context from the user: ${context || 'none'}`,
  });
  return output;
}
