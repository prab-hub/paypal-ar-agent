import { z } from 'zod';
import { getInvoice, remindInvoice } from '@/lib/paypal';
import { draftReminder } from '@/lib/reminder';
import { limit } from '@/lib/ratelimit';
import { markReminded } from '@/lib/reminded';

export const maxDuration = 60;

// GET: AI drafts a reminder for review. POST: sends the (possibly edited) reminder through PayPal.
export async function GET(req: Request, ctx: RouteContext<'/api/invoices/[id]/remind'>) {
  const limited = limit(req);
  if (limited) return limited;
  const { id } = await ctx.params;
  const context = new URL(req.url).searchParams.get('context') ?? '';
  try {
    return Response.json(await draftReminder(await getInvoice(id), context.slice(0, 1000)));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

const Body = z.object({ subject: z.string().min(1).max(200), note: z.string().min(1).max(4000) });

export async function POST(req: Request, ctx: RouteContext<'/api/invoices/[id]/remind'>) {
  const limited = limit(req);
  if (limited) return limited;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Subject and note are required' }, { status: 400 });
  try {
    await remindInvoice(id, parsed.data.subject, parsed.data.note);
    markReminded(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
