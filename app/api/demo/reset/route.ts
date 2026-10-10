import { resetDemo } from '@/lib/seed';
import { limit } from '@/lib/ratelimit';

export const maxDuration = 120;

// One reset at a time and at most one a minute: each reset is ~40 PayPal calls.
const g = globalThis as unknown as { __resetAt?: number; __resetting?: boolean };

export async function POST(req: Request) {
  const limited = limit(req);
  if (limited) return limited;
  if (g.__resetting || (g.__resetAt && Date.now() - g.__resetAt < 60_000)) {
    return Response.json({ error: 'The demo was just reset. Try again in a minute.' }, { status: 429 });
  }
  g.__resetting = true;
  try {
    const result = await resetDemo();
    g.__resetAt = Date.now();
    return Response.json(result, { status: result.created ? 200 : 502 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  } finally {
    g.__resetting = false;
  }
}
