// PayPal Agent Toolkit tools, adapted to AI SDK 7.
// The toolkit's ai-sdk export builds AI SDK v4 tools ({ description, parameters, execute }); v7 expects
// inputSchema, so we re-wrap each one. Only AR-relevant actions are enabled.
import 'server-only';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { tool, type ToolSet } from 'ai';

const ACTIONS = {
  invoices: {
    list: true, get: true, search: true, generateInvoiceNumber: true,
    create: true, send: true, sendReminder: true, cancel: true,
    recordPayment: true, recordRefund: true, createConditionalRules: true,
    setupReminders: true, cancelReminders: true, generateQRC: true,
  },
  transactions: { list: true },
  insights: { get: true },
  disputes: { list: true, get: true },
  orders: { get: true },
};

// Tools that only read. Everything else changes money or customer-facing state and needs a human click.
export const READ_ONLY = new Set([
  'list_invoices', 'get_invoice', 'search_invoicing', 'generate_invoice_number', 'generate_invoice_qr_code',
  'list_transactions', 'get_merchant_insights', 'list_disputes', 'get_dispute', 'get_order',
]);

let toolkit: PayPalAgentToolkit | null = null;

export function paypalTools(): ToolSet {
  toolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: { actions: ACTIONS, context: { sandbox: process.env.PAYPAL_ENV !== 'live' } },
  });
  const raw = toolkit.getTools() as unknown as Record<
    string,
    { description?: string; parameters: Parameters<typeof tool>[0]['inputSchema']; execute: (args: unknown) => Promise<unknown> }
  >;
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(raw)) {
    out[name] = tool({
      description: t.description,
      inputSchema: t.parameters,
      execute: async (args: unknown) => t.execute(args),
    });
  }
  return out;
}
