import { extractDraft } from '@/lib/extract';
import { limit } from '@/lib/ratelimit';

export const maxDuration = 60;

export async function POST(req: Request) {
  const limited = limit(req);
  if (limited) return limited;
  const { text } = (await req.json()) as { text?: string };
  if (!text || text.trim().length < 20) {
    return Response.json({ error: 'Paste a scope, quote, PO or email (at least a sentence).' }, { status: 400 });
  }
  try {
    return Response.json(await extractDraft(text));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
