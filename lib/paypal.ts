// Thin PayPal REST client for the deterministic parts of the app (create, send, remind, list).
// The free-form agent uses @paypal/agent-toolkit instead (see lib/agent-tools.ts).
import 'server-only';

const BASE =
  process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

let cached: { token: string; expires: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const d = await res.json();
  cached = { token: d.access_token, expires: Date.now() + d.expires_in * 1000 };
  return cached.token;
}

export class PayPalError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`PayPal ${status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
}

export async function pp<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(res.status, data);
  return data as T;
}

export type Money = { currency_code: string; value: string };

export type PPInvoice = {
  id: string;
  status: string; // DRAFT, SENT, SCHEDULED, PAID, MARKED_AS_PAID, CANCELLED, PARTIALLY_PAID, ...
  detail: {
    invoice_number?: string;
    invoice_date?: string;
    currency_code: string;
    note?: string;
    memo?: string;
    payment_term?: { term_type?: string; due_date?: string };
    viewed_by_recipient?: boolean;
  };
  primary_recipients?: { billing_info?: { email_address?: string; name?: { given_name?: string; surname?: string; full_name?: string }; business_name?: string } }[];
  items?: { name: string; description?: string; quantity: string; unit_amount: Money }[];
  amount?: Money;
  due_amount?: Money;
  payments?: { paid_amount?: Money; transactions?: { payment_id?: string; method?: string; date?: string; amount?: Money; note?: string }[] };
};

export async function listInvoices(): Promise<PPInvoice[]> {
  const out: PPInvoice[] = [];
  for (let page = 1; page <= 10; page++) {
    const d = await pp<{ items?: PPInvoice[]; total_pages?: number }>(
      `/v2/invoicing/invoices?page=${page}&page_size=100&total_required=true&fields=amount`,
    );
    out.push(...(d.items ?? []));
    if (!d.total_pages || page >= d.total_pages) break;
  }
  return out;
}

export const getInvoice = (id: string) => pp<PPInvoice>(`/v2/invoicing/invoices/${encodeURIComponent(id)}`);

export async function createInvoice(body: unknown): Promise<PPInvoice> {
  // With Prefer: return=representation PayPal returns the invoice; older responses return only a link.
  const d = await pp<PPInvoice & { href?: string }>('/v2/invoicing/invoices', { method: 'POST', body });
  if (d.id) return d;
  const id = d.href?.split('/').pop();
  if (!id) throw new Error('PayPal did not return an invoice id');
  return getInvoice(id);
}

export const sendInvoice = (id: string, note?: string) =>
  pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    body: { send_to_invoicer: false, send_to_recipient: true, ...(note ? { note } : {}) },
  });

export const remindInvoice = (id: string, subject: string, note: string) =>
  pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
    method: 'POST',
    body: { subject, note, send_to_invoicer: false, send_to_recipient: true },
  });

export const deleteInvoice = (id: string) =>
  pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}`, { method: 'DELETE' });
