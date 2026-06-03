// fonthead.dev — nightly cron worker. A standalone Cloudflare Worker bound to
// the same D1 database. Its only job: compute the previous day's most-liked
// public fonts and store the day's featured set. Runs on the schedule in
// wrangler.cron.jsonc. The main app reads the featured row for its hero.
import { computeAndStoreFeatured } from '../src/lib/featured';

interface CronEnv {
  DB: D1Database;
}

export default {
  async scheduled(_event: unknown, env: CronEnv, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(
      computeAndStoreFeatured(env.DB).then((r) =>
        console.log(`[cron] featured ${r.date}: ${r.counted} fonts`),
      ),
    );
  },
};
