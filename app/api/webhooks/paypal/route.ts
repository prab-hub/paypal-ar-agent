import { verifyWebhook } from '@/lib/paypal';
import { pushEvent } from '@/lib/events';
import { SEED_MEMO } from '@/lib/seed';

type Event = {
  id: string;
  event_type: string;
  summary?: string;
  create_time?: string;
  resource?: { id?: string; invoice?: { id?: string; detail?: { invoice_number?: string; memo?: string } } };
};

// PayPal calls this for invoice and dispute events (registered on the sandbox app). Only verified events count.
export async function POST(req: Request) {
  const raw = await req.text();
  let event: Event;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const ok = await verifyWebhook(req.headers, event).catch(() => false);
  if (!ok) return new Response('unverified', { status: 401 });
  const inv = event.resource?.invoice;
  // A demo reset cancels the old seed invoices; that's housekeeping, not news.
  if (event.event_type === 'INVOICING.INVOICE.CANCELLED' && inv?.detail?.memo === SEED_MEMO) return new Response('ok');
  pushEvent({
    id: event.id,
    type: event.event_type,
    summary: event.summary || event.event_type,
    at: event.create_time ?? new Date().toISOString(),
    resourceId: inv?.detail?.invoice_number ? `Invoice ${inv.detail.invoice_number}` : event.resource?.id ?? '',
  });
  return new Response('ok');
}
