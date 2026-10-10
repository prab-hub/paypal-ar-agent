// When each invoice was last reminded from Settle. PayPal's invoice API doesn't expose reminder history, so this is
// kept in server memory: good enough for a demo (Fluid compute reuses instances), lost on a cold start.
import 'server-only';

const g = globalThis as unknown as { __reminded?: Map<string, string> };
const store = (g.__reminded ??= new Map<string, string>());

export const markReminded = (id: string) => store.set(id, new Date().toISOString());
export const remindedMap = (): Record<string, string> => Object.fromEntries(store);
