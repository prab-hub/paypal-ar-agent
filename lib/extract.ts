// Turn a messy scope, PO, quote or email thread into a PayPal-ready invoice draft.
import 'server-only';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { model } from './model';

export const DraftSchema = z.object({
  customer_name: z.string().describe('Person or company being billed. Empty string if unknown.'),
  customer_email: z.string().describe('Billing email address. Empty string if not in the text.'),
  currency: z.string().describe('ISO 4217 code, e.g. USD. Default USD if not stated.'),
  due_in_days: z.number().int().describe('Payment terms in days (Net 30 = 30, due on receipt = 0). Default 30.'),
  items: z
    .array(
      z.object({
        name: z.string().describe('Short line item name, max 200 chars'),
        description: z.string().describe('Optional detail, empty string if none'),
        quantity: z.number().describe('Quantity or hours'),
        unit_price: z.number().describe('Price per unit in the invoice currency, no symbols'),
      }),
    )
    .describe('Billable line items. Do not invent prices: if a price is missing use 0 and say so in warnings.'),
  note: z.string().describe('Short note to the customer for the invoice, e.g. project name or PO reference.'),
  po_number: z.string().describe('Customer PO or reference number if present, else empty string.'),
  warnings: z.array(z.string()).describe('Anything ambiguous a human should check before sending.'),
});

export type Draft = z.infer<typeof DraftSchema>;

export async function extractDraft(text: string): Promise<Draft> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: DraftSchema }),
    system:
      'You are an accounts receivable specialist. Read the source text (a statement of work, quote, purchase order, ' +
      'timesheet or email thread) and produce the invoice that should be sent. Bill only what the text says has been ' +
      'agreed or delivered. Keep the customer\'s own wording for line items. Never invent prices, emails or quantities.',
    prompt: text.slice(0, 20_000),
  });
  return output;
}
