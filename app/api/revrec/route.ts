import { buildRevRecInputs } from '@/lib/revrec-classify';
import { limit } from '@/lib/ratelimit';

export const maxDuration = 120;

export async function GET(req: Request) {
  const limited = limit(req);
  if (limited) return limited;
  try {
    return Response.json(await buildRevRecInputs());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
