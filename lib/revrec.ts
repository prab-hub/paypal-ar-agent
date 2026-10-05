// Revenue recognition schedule (ASC 606 / IFRS 15 style). Pure functions, used on client and server.
// Each invoice line is one performance obligation, recognized either at a point in time or ratably over a
// service period. Ratable: every full month gets the same amount (amount / months), a partial first or last
// month gets that amount times the share of its own days covered, and the last month takes the rounding
// remainder so the schedule always adds up to the line amount.

export type Method = 'point_in_time' | 'ratable';

export type Obligation = {
  key: string; // invoiceId:lineIndex
  invoiceId: string;
  invoiceNumber: string;
  customer: string;
  currency: string;
  item: string;
  amount: number;
  method: Method;
  start: string; // yyyy-mm-dd. Point in time: delivery date. Ratable: service start.
  end: string; // yyyy-mm-dd, exclusive. Ratable only; ignored for point in time.
  rationale: string;
};

export type CashEvent = { date: string; amount: number; currency: string; invoiceNumber: string };

export type WaterfallRow = {
  month: string; // yyyy-mm
  billed: number;
  collected: number;
  recognized: number;
  deferred: number; // billed to date minus recognized to date, when positive (liability)
  unbilled: number; // recognized to date minus billed to date, when positive (contract asset)
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

const parse = (iso: string) => new Date(iso + 'T00:00:00Z');
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Whole months between start and end plus the fractional edge months, measured the same way the schedule is.
function termMonths(start: Date, end: Date): number {
  let total = 0;
  for (let m = monthStart(start); m < end; m = nextMonth(m)) {
    const n = nextMonth(m);
    const from = m < start ? start : m;
    const to = n > end ? end : n;
    total += days(from, to) / days(m, n);
  }
  return total;
}

export function lineSchedule(o: Obligation): Map<string, number> {
  const out = new Map<string, number>();
  const start = parse(o.start);
  if (Number.isNaN(start.getTime())) return out;
  const end = parse(o.end);
  if (o.method === 'point_in_time' || Number.isNaN(end.getTime()) || end <= start) {
    out.set(monthKey(start), r2(o.amount));
    return out;
  }
  const perMonth = o.amount / termMonths(start, end);
  const months: Date[] = [];
  for (let m = monthStart(start); m < end && months.length < 240; m = nextMonth(m)) months.push(m);
  let sum = 0;
  months.forEach((m, i) => {
    const n = nextMonth(m);
    const from = m < start ? start : m;
    const to = n > end ? end : n;
    const amt = i === months.length - 1 ? r2(o.amount - sum) : r2((perMonth * days(from, to)) / days(m, n));
    out.set(monthKey(m), amt);
    sum = r2(sum + amt);
  });
  return out;
}

export function waterfall(obligations: Obligation[], billed: CashEvent[], collected: CashEvent[]): WaterfallRow[] {
  const rec = new Map<string, number>();
  const bil = new Map<string, number>();
  const col = new Map<string, number>();
  const add = (map: Map<string, number>, k: string, v: number) => map.set(k, r2((map.get(k) ?? 0) + v));
  for (const o of obligations) for (const [k, v] of lineSchedule(o)) add(rec, k, v);
  for (const e of billed) add(bil, e.date.slice(0, 7), e.amount);
  for (const e of collected) add(col, e.date.slice(0, 7), e.amount);
  const keys = [...new Set([...rec.keys(), ...bil.keys(), ...col.keys()])].sort();
  if (!keys.length) return [];
  // Fill gaps so the table has every month between first and last.
  const all: string[] = [];
  for (let m = parse(keys[0] + '-01'); monthKey(m) <= keys[keys.length - 1]; m = nextMonth(m)) all.push(monthKey(m));
  let cumB = 0;
  let cumR = 0;
  return all.map((k) => {
    const b = bil.get(k) ?? 0;
    const r = rec.get(k) ?? 0;
    cumB = r2(cumB + b);
    cumR = r2(cumR + r);
    const diff = r2(cumB - cumR);
    return { month: k, billed: b, collected: col.get(k) ?? 0, recognized: r, deferred: Math.max(0, diff), unbilled: Math.max(0, -diff) };
  });
}

// One row per obligation per month, for the CSV export an accountant would load into a journal.
export function scheduleCsv(obligations: Obligation[]): string {
  const months = [...new Set(obligations.flatMap((o) => [...lineSchedule(o).keys()]))].sort();
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ['Invoice', 'Customer', 'Item', 'Method', 'Start', 'End', 'Amount', 'Currency', ...months.map(monthLabel)];
  const rows = obligations.map((o) => {
    const s = lineSchedule(o);
    return [o.invoiceNumber, o.customer, o.item, o.method, o.start, o.method === 'ratable' ? o.end : '', o.amount.toFixed(2), o.currency, ...months.map((m) => (s.get(m) ?? 0).toFixed(2))];
  });
  return [head, ...rows].map((r) => r.map((c) => esc(String(c))).join(',')).join('\n');
}
