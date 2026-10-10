import { reconcile } from '@/lib/reconcile';
import { limit } from '@/lib/ratelimit';

export const maxDuration = 60;

export async function GET(req: Request) {
  const limited = limit(req);
  if (limited) return limited;
  try {
    return Response.json(await reconcile());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
