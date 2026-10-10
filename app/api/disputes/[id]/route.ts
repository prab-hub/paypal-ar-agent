import { z } from 'zod';
import { analyzeDispute, EVIDENCE_TYPES } from '@/lib/disputes';
import { acceptClaim, getDispute, makeOffer, provideEvidence, sendDisputeMessage } from '@/lib/paypal';
import { limit } from '@/lib/ratelimit';

export const maxDuration = 60;

// GET: AI recommendation and evidence draft. POST: the action the user chose and clicked.
export async function GET(req: Request, ctx: RouteContext<'/api/disputes/[id]'>) {
  const limited = limit(req);
  if (limited) return limited;
  const { id } = await ctx.params;
  try {
    return Response.json(await analyzeDispute(id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), note: z.string().min(1).max(2000) }),
  z.object({ action: z.literal('offer_refund'), note: z.string().min(1).max(2000), amount: z.number().positive() }),
  z.object({
    action: z.literal('contest'),
    evidence: z.array(z.object({ evidence_type: z.enum(EVIDENCE_TYPES), notes: z.string().min(1).max(2000) })).min(1),
  }),
  z.object({ action: z.literal('message'), note: z.string().min(1).max(2000) }),
]);

export async function POST(req: Request, ctx: RouteContext<'/api/disputes/[id]'>) {
  const limited = limit(req);
  if (limited) return limited;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Bad request' }, { status: 400 });
  const b = parsed.data;
  try {
    if (b.action === 'accept') await acceptClaim(id, b.note);
    else if (b.action === 'message') await sendDisputeMessage(id, b.note);
    else if (b.action === 'contest') await provideEvidence(id, b.evidence);
    else {
      const d = await getDispute(id);
      await makeOffer(id, b.note, { currency_code: d.dispute_amount?.currency_code ?? 'USD', value: b.amount.toFixed(2) });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
