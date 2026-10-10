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

export async function pp<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const method = init.method ?? 'GET';
  try {
    return await request<T>(path, init);
  } catch (e) {
    // Sandbox occasionally answers a read with an empty or non-JSON body or a 5xx. Reads are safe to retry once.
    const transient = !(e instanceof PayPalError) || e.status >= 500;
    if (retry && method === 'GET' && transient) {
      await new Promise((r) => setTimeout(r, 400));
      return pp<T>(path, init, false);
    }
    throw e;
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown }): Promise<T> {
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
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new PayPalError(res.status >= 400 ? res.status : 502, { message: `Non-JSON response: ${text.slice(0, 200)}` });
  }
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
  payments?: { paid_amount?: Money; transactions?: PPPayment[] };
};

// type is EXTERNAL for payments recorded by the merchant (cash, bank transfer) and PAYPAL for checkout payments.
export type PPPayment = { type?: string; payment_id?: string; transaction_id?: string; method?: string; payment_date?: string; amount?: Money; note?: string };

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

export const cancelInvoice = (id: string) =>
  pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { send_to_recipient: false, send_to_invoicer: false },
  });

// send_to_recipient: false still moves the invoice to UNPAID without emailing anyone (used by the demo seed).
export const sendInvoiceSilently = (id: string) =>
  pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { method: 'POST', body: { send_to_recipient: false, send_to_invoicer: false } });

export const recordPayment = (id: string, p: { method: string; date: string; amount: Money; note?: string }) =>
  pp<{ payment_id: string }>(`/v2/invoicing/invoices/${encodeURIComponent(id)}/payments`, {
    method: 'POST',
    body: { method: p.method, payment_date: p.date, amount: p.amount, ...(p.note ? { note: p.note } : {}) },
  });

export const deletePayment = (id: string, paymentId: string) =>
  pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`, { method: 'DELETE' });

// A PayPal checkout payment's capture carries the fee and net amount.
export type PPCapture = {
  id: string;
  status: string;
  amount: Money;
  seller_receivable_breakdown?: { gross_amount: Money; paypal_fee?: Money; net_amount?: Money };
};
export const getCapture = (id: string) => pp<PPCapture>(`/v2/payments/captures/${encodeURIComponent(id)}`);

// Transaction Search must be enabled on the REST app; until then PayPal answers 403 NOT_AUTHORIZED.
export type PPTransaction = {
  transaction_info: {
    transaction_id: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_amount?: Money;
    fee_amount?: Money;
    invoice_id?: string;
    transaction_status?: string;
  };
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string } };
};
export async function listTransactions(days = 31): Promise<PPTransaction[]> {
  const end = new Date();
  const start = new Date(end.getTime() - Math.min(days, 31) * 86_400_000);
  const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '-0000');
  const d = await pp<{ transaction_details?: PPTransaction[] }>(
    `/v1/reporting/transactions?start_date=${fmt(start)}&end_date=${fmt(end)}&fields=transaction_info,payer_info&page_size=500`,
  );
  return d.transaction_details ?? [];
}

// Disputes (customer disputes API). The toolkit can list, get and accept; evidence goes through REST.
export type PPDispute = {
  dispute_id: string;
  reason?: string;
  status?: string;
  dispute_state?: string;
  dispute_amount?: Money;
  create_time?: string;
  update_time?: string;
  dispute_life_cycle_stage?: string;
  seller_response_due_date?: string;
  disputed_transactions?: {
    seller_transaction_id?: string;
    buyer_transaction_id?: string;
    invoice_number?: string;
    gross_amount?: Money;
    buyer?: { name?: string; email?: string };
    items?: { item_name?: string; item_description?: string }[];
  }[];
  messages?: { posted_by?: string; time_posted?: string; content?: string }[];
  offer?: unknown;
  links?: { rel: string; href: string; method: string }[];
};

export async function listDisputes(): Promise<PPDispute[]> {
  const d = await pp<{ items?: PPDispute[] }>('/v1/customer/disputes?page_size=50');
  return d.items ?? [];
}
export const getDispute = (id: string) => pp<PPDispute>(`/v1/customer/disputes/${encodeURIComponent(id)}`);

export const acceptClaim = (id: string, note: string) =>
  pp(`/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, { method: 'POST', body: { note } });

export const sendDisputeMessage = (id: string, message: string) =>
  pp(`/v1/customer/disputes/${encodeURIComponent(id)}/send-message`, { method: 'POST', body: { message } });

// provide-evidence is multipart: a JSON "input" part, with optional files. We send notes only (no files).
export async function provideEvidence(id: string, evidence: { evidence_type: string; notes: string }[]) {
  const form = new FormData();
  form.append(
    'input',
    new Blob([JSON.stringify({ evidences: evidence.map((e) => ({ evidence_type: e.evidence_type, notes: e.notes })) })], {
      type: 'application/json',
    }),
  );
  const res = await fetch(`${BASE}/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
    body: form,
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new PayPalError(res.status, text ? JSON.parse(text) : {});
  return text ? JSON.parse(text) : {};
}

// Webhook signature check: PayPal verifies its own headers against the webhook id we registered.
export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const d = await pp<{ verification_status?: string }>('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: headers.get('paypal-auth-algo'),
      cert_url: headers.get('paypal-cert-url'),
      transmission_id: headers.get('paypal-transmission-id'),
      transmission_sig: headers.get('paypal-transmission-sig'),
      transmission_time: headers.get('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return d.verification_status === 'SUCCESS';
}

export const makeOffer = (id: string, note: string, amount: Money) =>
  pp(`/v1/customer/disputes/${encodeURIComponent(id)}/make-offer`, {
    method: 'POST',
    body: { note, offer_amount: amount, offer_type: 'REFUND' },
  });
