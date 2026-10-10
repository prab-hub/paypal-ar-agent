// Demo data: a realistic receivables book across every collection stage, written to the PayPal sandbox.
// Seeded invoices carry a private memo so Reset only ever touches its own invoices, never ones a visitor made.
import 'server-only';
import {
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  deletePayment,
  getInvoice,
  listInvoices,
  recordPayment,
  sendInvoiceSilently,
} from './paypal';

export const SEED_MEMO = 'settle-demo-seed';

// The sandbox's US personal buyers. PayPal blocks invoices to recipients in some countries (India), so stick to these.
const BUYERS = ['sb-wx9uk53193568@personal.example.com', 'sb-338kk53193484@personal.example.com'];

type Line = { name: string; description?: string; quantity: number; price: number };
type Spec = {
  customer: string;
  issuedDaysAgo: number;
  termsDays: number;
  note: string;
  reference?: string;
  items: Line[];
  // Recorded payments: amount, days ago, method. A short pay leaves a small balance on purpose.
  payments?: { amount: number; daysAgo: number; method: string; note: string }[];
};

const SPECS: Spec[] = [
  {
    customer: 'Northwind Studio',
    issuedDaysAgo: 52,
    termsDays: 15,
    note: 'Brand refresh, phase 1',
    reference: 'NW-4471',
    items: [
      { name: 'Brand identity package', description: 'Logo, palette, type system, usage guide', quantity: 1, price: 3200 },
      { name: 'Website hosting (August)', quantity: 1, price: 250 },
    ],
  },
  {
    customer: 'Bluefin Analytics',
    issuedDaysAgo: 40,
    termsDays: 20,
    note: 'Q3 data platform work',
    reference: 'PO-88213',
    items: [
      { name: 'Data pipeline build', description: 'Ingestion from Stripe and HubSpot into BigQuery', quantity: 1, price: 3600 },
      { name: 'Dashboard support plan (3 months)', quantity: 1, price: 1200 },
    ],
    payments: [{ amount: 2000, daysAgo: 12, method: 'BANK_TRANSFER', note: 'Partial wire, remainder promised next month' }],
  },
  {
    customer: 'Cedar & Pine Legal',
    issuedDaysAgo: 25,
    termsDays: 15,
    note: 'Client portal redesign',
    items: [{ name: 'Client portal design sprint', description: '32 hours at $95/hr', quantity: 32, price: 95 }],
  },
  {
    customer: 'Harbor Coffee Co.',
    issuedDaysAgo: 18,
    termsDays: 14,
    note: 'Online ordering launch',
    items: [
      { name: 'Online ordering integration', description: 'Square menu sync and checkout', quantity: 1, price: 1850 },
      { name: 'Monthly maintenance (October)', quantity: 1, price: 300 },
    ],
  },
  {
    customer: 'Lumen Health',
    issuedDaysAgo: 30,
    termsDays: 30,
    note: 'Annual subscription renewal',
    reference: 'LH-2026-114',
    items: [{ name: 'Annual analytics subscription', description: '12-month term from the invoice date', quantity: 1, price: 6000 }],
  },
  {
    customer: 'Atlas Logistics',
    issuedDaysAgo: 13,
    termsDays: 15,
    note: 'Pilot engagement',
    items: [{ name: 'Route optimization pilot', description: 'Model, backtest and handover report', quantity: 1, price: 2400 }],
  },
  {
    customer: 'Quill Publishing',
    issuedDaysAgo: 5,
    termsDays: 30,
    note: 'Q4 marketing retainer',
    items: [
      { name: 'Q4 marketing retainer (monthly fee x3)', quantity: 3, price: 1500 },
      { name: 'Campaign setup fee', quantity: 1, price: 500 },
    ],
  },
  {
    customer: 'Orbit Fitness',
    issuedDaysAgo: 45,
    termsDays: 15,
    note: 'App onboarding',
    items: [{ name: 'Mobile app onboarding flow', description: 'Design and build, 5 screens', quantity: 1, price: 2750 }],
    payments: [{ amount: 2750, daysAgo: 31, method: 'BANK_TRANSFER', note: 'ACH' }],
  },
  {
    customer: 'Maple Dental Group',
    issuedDaysAgo: 35,
    termsDays: 30,
    note: 'Automation project',
    items: [{ name: 'Patient reminder automation', description: 'SMS and email reminders from the booking system', quantity: 1, price: 1500 }],
    payments: [{ amount: 1450, daysAgo: 3, method: 'WIRE_TRANSFER', note: 'Wire received, bank deducted charges' }],
  },
  {
    customer: 'Juniper Retail',
    issuedDaysAgo: 60,
    termsDays: 30,
    note: 'Holiday campaign',
    items: [
      { name: 'Holiday campaign landing pages', quantity: 1, price: 1900 },
      { name: 'Hosting (September to November)', quantity: 1, price: 450 },
    ],
    payments: [{ amount: 2350, daysAgo: 20, method: 'CHECK', note: 'Check #10442' }],
  },
];

const iso = (daysAgo: number, now = new Date()) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);

async function createOne(spec: Spec, i: number, now: Date) {
  const inv = await createInvoice({
    detail: {
      currency_code: 'USD',
      invoice_date: iso(spec.issuedDaysAgo, now),
      payment_term: { due_date: iso(spec.issuedDaysAgo - spec.termsDays, now) },
      note: spec.note,
      memo: SEED_MEMO,
      ...(spec.reference ? { reference: spec.reference } : {}),
    },
    primary_recipients: [{ billing_info: { email_address: BUYERS[i % BUYERS.length], business_name: spec.customer } }],
    items: spec.items.map((l) => ({
      name: l.name,
      ...(l.description ? { description: l.description } : {}),
      quantity: String(l.quantity),
      unit_amount: { currency_code: 'USD', value: l.price.toFixed(2) },
    })),
  });
  // Silent send: the invoice becomes UNPAID without emailing the sandbox buyer ten times per reset.
  await sendInvoiceSilently(inv.id);
  for (const p of spec.payments ?? []) {
    await recordPayment(inv.id, {
      method: p.method,
      date: iso(p.daysAgo, now),
      amount: { currency_code: 'USD', value: p.amount.toFixed(2) },
      note: p.note,
    });
  }
  return inv.id;
}

// Cancel what the last seed made: recorded (external) payments come off first, since PayPal won't cancel a paid invoice.
async function clearSeed(): Promise<number> {
  const seeded = (await listInvoices()).filter((i) => i.detail.memo === SEED_MEMO && i.status !== 'CANCELLED');
  let cleared = 0;
  await inBatches(seeded, 4, async (s) => {
    try {
      if (s.status === 'DRAFT') {
        await deleteInvoice(s.id);
      } else {
        const full = await getInvoice(s.id);
        const tx = full.payments?.transactions ?? [];
        // A real PayPal payment (a sandbox buyer actually paid) can't be removed; leave that invoice alone.
        if (tx.some((t) => t.type !== 'EXTERNAL')) return;
        for (const t of tx) if (t.payment_id) await deletePayment(s.id, t.payment_id);
        await cancelInvoice(s.id);
      }
      cleared++;
    } catch {
      // One stuck invoice shouldn't block the reset.
    }
  });
  return cleared;
}

async function inBatches<T>(xs: T[], size: number, fn: (x: T, i: number) => Promise<unknown>) {
  for (let i = 0; i < xs.length; i += size) await Promise.all(xs.slice(i, i + size).map((x, j) => fn(x, i + j)));
}

export async function resetDemo(): Promise<{ cleared: number; created: number; failed: string[] }> {
  const cleared = await clearSeed();
  const now = new Date();
  const failed: string[] = [];
  let created = 0;
  await inBatches(SPECS, 4, async (spec, i) => {
    try {
      await createOne(spec, i, now);
      created++;
    } catch (e) {
      failed.push(`${spec.customer}: ${(e as Error).message.slice(0, 160)}`);
    }
  });
  return { cleared, created, failed };
}
