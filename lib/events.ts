// Recent PayPal webhook events, newest first. In memory (see lib/reminded.ts for why that's fine for the demo).
import 'server-only';

export type FeedEvent = { id: string; type: string; summary: string; at: string; resourceId: string };

const g = globalThis as unknown as { __events?: FeedEvent[] };
const events = (g.__events ??= []);

export function pushEvent(e: FeedEvent) {
  if (events.some((x) => x.id === e.id)) return; // PayPal retries deliveries
  events.unshift(e);
  events.splice(50);
}

export const recentEvents = () => events.slice(0, 20);
