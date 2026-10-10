import { recentEvents } from '@/lib/events';

export function GET() {
  return Response.json({ events: recentEvents() });
}
