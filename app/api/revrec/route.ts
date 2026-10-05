import { buildRevRecInputs } from '@/lib/revrec-classify';

export const maxDuration = 120;

export async function GET() {
  try {
    return Response.json(await buildRevRecInputs());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
