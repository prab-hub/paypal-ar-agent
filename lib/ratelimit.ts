// Small in-memory limiter for the public demo: caps AI and PayPal-write calls per visitor and per instance.
// Per-instance memory is not a hard guarantee on serverless (instances come and go), but with Fluid compute
// instances are reused, and it's enough to stop casual abuse of a hackathon demo without adding a database.
import 'server-only';

type Bucket = { count: number; reset: number };
const g = globalThis as unknown as { __rl?: Map<string, Bucket> };
const buckets = (g.__rl ??= new Map<string, Bucket>());

const LIMITS = {
  visitor: { max: 40, windowMs: 10 * 60_000 }, // per IP: 40 AI/write calls per 10 minutes
  global: { max: 600, windowMs: 60 * 60_000 }, // per instance: 600 per hour
};

function hit(key: string, max: number, windowMs: number): number | null {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return null;
  }
  if (b.count >= max) return Math.ceil((b.reset - now) / 1000);
  b.count++;
  return null;
}

function ip(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

// Returns a 429 response when over the limit, otherwise null.
export function limit(req: Request): Response | null {
  if (buckets.size > 10_000) buckets.clear(); // never grow without bound
  const wait =
    hit(`ip:${ip(req)}`, LIMITS.visitor.max, LIMITS.visitor.windowMs) ??
    hit('global', LIMITS.global.max, LIMITS.global.windowMs);
  if (wait === null) return null;
  return Response.json(
    { error: `Demo limit reached. Try again in ${Math.ceil(wait / 60)} min.` },
    { status: 429, headers: { 'Retry-After': String(wait) } },
  );
}
