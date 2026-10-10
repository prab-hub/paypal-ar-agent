// Builds the revenue recognition inputs from live PayPal invoices: AI decides how each line is earned
// (point in time vs over a service period); billing and cash come straight from PayPal.
import 'server-only';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { judgmentModel } from './model';
import { getInvoice, listInvoices, type PPInvoice } from './paypal';
import { toRow } from './ar';
import { MOVED_PREFIX } from './reconcile';
import type { CashEvent, Obligation } from './revrec';

const RECOGNIZED_STATUSES = new Set(['SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'MARKED_AS_PAID', 'SCHEDULED', 'PARTIALLY_REFUNDED']);

const Classification = z.object({
  lines: z.array(
    z.object({
      key: z.string().describe('The key given for the line, unchanged'),
      method: z.enum(['point_in_time', 'ratable']),
      start: z.string().describe('yyyy-mm-dd. Point in time: date delivered. Ratable: first day of service.'),
      end: z.string().describe('yyyy-mm-dd, exclusive (day after service ends). Same as start for point in time.'),
      rationale: z.string().describe('One short sentence citing the words in the line that drove the decision'),
    }),
  ),
});

const SYSTEM = `You are a revenue accountant applying ASC 606 / IFRS 15 to invoice lines from a small service business.
Each line is one performance obligation priced at its standalone selling price. Decide each line on its OWN item
name and description first; the invoice note is background only and never turns a one-time deliverable into a
service period.

- point_in_time: a deliverable handed over once (design work, a build, QA, a report, a setup or onboarding fee,
  goods) or hours/support already worked. start = the delivery date and end = start.
  Delivery date: if the line or note names a past period the work was done in ("September support", "hours for
  August"), use the LAST day of that period. Otherwise use the invoice date.
- ratable: a service the customer receives continuously over a period (subscription, retainer fee, hosting,
  maintenance plan, support plan, license term, membership). start = first day of service, end = the day AFTER
  it ends (exclusive). Named month: 1st of that month to 1st of next. "N-month" term: invoice date (or stated
  start) plus N months. Named quarter: first day of the quarter to first day of the next quarter.

Examples (invoice date 2026-10-05):
- "Design sprint for the new pricing page", note "Q4 retainer" -> point_in_time 2026-10-05 (a deliverable; the note does not change it)
- "Webflow build and QA" -> point_in_time 2026-10-05
- "October hosting" -> ratable 2026-10-01 to 2026-11-01
- "Support hours", note "September support" -> point_in_time 2026-09-30
- "Annual analytics subscription" -> ratable 2026-10-05 to 2027-10-05
- "Q4 marketing retainer (monthly fee x3)" -> ratable 2026-10-01 to 2027-01-01

The rationale must agree with the dates you return. If unsure, choose point_in_time on the invoice date and say why.`;

const PROMPT_VERSION = 2;

// Classification is the slow part, and the model can answer differently on a re-run, so cache by invoice id +
// line content. Kept on globalThis so the page and the agent (separate route bundles) see the same answer.
type Cached = Omit<Obligation, 'amount' | 'currency' | 'customer' | 'invoiceNumber' | 'invoiceId'>;
const g = globalThis as unknown as { __revrecCache?: Map<string, Cached> };
const cache = (g.__revrecCache ??= new Map<string, Cached>());

function lineAmount(it: NonNullable<PPInvoice['items']>[number]): number {
  return Math.round(Number(it.quantity) * Number(it.unit_amount.value) * 100) / 100;
}

export async function buildRevRecInputs(): Promise<{ obligations: Obligation[]; billed: CashEvent[]; collected: CashEvent[]; skipped: string[] }> {
  const list = (await listInvoices()).filter((i) => RECOGNIZED_STATUSES.has(i.status));
  const invoices = await Promise.all(list.map((i) => getInvoice(i.id)));

  const lines = invoices.flatMap((inv) =>
    (inv.items ?? []).map((it, idx) => {
      const sig = `${PROMPT_VERSION}:${inv.id}:${idx}:${it.name}:${it.description ?? ''}:${lineAmount(it)}`;
      return { inv, it, idx, sig, key: `${inv.id}:${idx}` };
    }),
  );

  const todo = lines.filter((l) => !cache.has(l.sig));
  if (todo.length) {
    const prompt = todo
      .map((l) =>
        JSON.stringify({
          key: l.key,
          invoice_date: l.inv.detail.invoice_date,
          due_date: l.inv.detail.payment_term?.due_date,
          invoice_note: l.inv.detail.note ?? '',
          item: l.it.name,
          description: l.it.description ?? '',
          quantity: l.it.quantity,
          amount: lineAmount(l.it),
        }),
      )
      .join('\n');
    const { output } = await generateText({ model: judgmentModel, system: SYSTEM, output: Output.object({ schema: Classification }), prompt });
    const byKey = new Map(output.lines.map((c) => [c.key, c]));
    for (const l of todo) {
      const c = byKey.get(l.key);
      const fallback = l.inv.detail.invoice_date ?? new Date().toISOString().slice(0, 10);
      cache.set(l.sig, {
        key: l.key,
        item: l.it.name,
        method: c?.method ?? 'point_in_time',
        start: c?.start || fallback,
        end: c?.method === 'ratable' && c.end > c.start ? c.end : c?.start || fallback,
        // A ratable line without a valid period can't be scheduled; treat it as point in time.
        ...(c?.method === 'ratable' && !(c.end > c.start) ? { method: 'point_in_time' as const } : {}),
        rationale: c?.rationale ?? 'Not classified; defaulted to the invoice date.',
      });
    }
  }

  // One currency per schedule. Use the most common one and report the rest as skipped.
  const counts = new Map<string, number>();
  invoices.forEach((i) => counts.set(i.detail.currency_code, (counts.get(i.detail.currency_code) ?? 0) + 1));
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';
  const skipped = invoices.filter((i) => i.detail.currency_code !== currency).map((i) => `${i.detail.invoice_number} (${i.detail.currency_code})`);
  const inCur = new Set(invoices.filter((i) => i.detail.currency_code === currency).map((i) => i.id));

  const obligations: Obligation[] = lines
    .filter((l) => inCur.has(l.inv.id))
    .map((l) => {
      const row = toRow(l.inv);
      return { ...cache.get(l.sig)!, invoiceId: l.inv.id, invoiceNumber: row.number, customer: row.customer, currency, amount: lineAmount(l.it) };
    });

  const billed: CashEvent[] = [];
  const collected: CashEvent[] = [];
  for (const inv of invoices) {
    if (!inCur.has(inv.id)) continue;
    const num = inv.detail.invoice_number ?? '';
    // Billed = sum of line amounts (revenue, excluding tax), on the invoice date.
    const total = (inv.items ?? []).reduce((s, it) => s + lineAmount(it), 0);
    billed.push({ date: inv.detail.invoice_date ?? '', amount: Math.round(total * 100) / 100, currency, invoiceNumber: num });
    for (const t of inv.payments?.transactions ?? []) {
      if (t.note?.startsWith(MOVED_PREFIX)) continue; // a balance moved to another invoice, not cash
      if (t.amount && t.payment_date) collected.push({ date: t.payment_date.slice(0, 10), amount: Number(t.amount.value), currency, invoiceNumber: num });
    }
  }
  return { obligations, billed, collected, skipped };
}
