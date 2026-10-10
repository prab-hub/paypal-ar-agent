import { listDisputeViews } from '@/lib/disputes';

export async function GET() {
  try {
    return Response.json({ disputes: await listDisputeViews() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
