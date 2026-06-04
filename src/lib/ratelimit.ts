// Fixed-window rate limiter backed by the SESSION KV namespace. Approximate by
// design: KV is eventually consistent and the read-then-write is not atomic, so
// a burst can slip a few over the limit. That is fine for abuse mitigation, and
// it needs no extra infrastructure. Returns true when the call is within budget.
export async function rateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${bucket}`;
  const cur = parseInt((await kv.get(k)) || '0', 10) || 0;
  if (cur >= limit) return false;
  // keep the counter for two windows so a slow clock can't reset it early
  await kv.put(k, String(cur + 1), { expirationTtl: windowSec * 2 });
  return true;
}
