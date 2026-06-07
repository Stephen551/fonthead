// Dynamic sitemap: static routes plus every public font page and maker profile,
// so search engines can discover /f/:id and /u/:handle. Each URL carries a
// <lastmod> from the font's created_at, since the whole value of the site is
// freshly published community fonts.
import type { APIRoute } from 'astro';

export const prerender = false;

// D1 stores created_at as 'YYYY-MM-DD HH:MM:SS' (UTC). Convert to a W3C datetime,
// or return null if it does not parse so the URL just omits <lastmod>.
function isoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// A handle is safe to put in a /u/ URL only if it is slug-shaped. Stand-in faces
// credit their original designer's full name (spaces, capitals) and have no /u/
// page, so those are dropped rather than emitted as broken, 404-ing URLs.
const slugSafe = (h: string) => /^[a-z0-9][a-z0-9._-]*$/.test(h);

export const GET: APIRoute = async ({ locals, url }) => {
  const env = locals.runtime.env;
  const origin = url.origin;
  const rows = await env.DB.prepare(
    "SELECT id, maker_handle, created_at FROM fonts WHERE visibility = 'public' ORDER BY created_at DESC LIMIT 5000",
  ).all<{ id: string; maker_handle: string; created_at: string }>();
  const fonts = rows.results ?? [];

  // newest first, so the first time we see a handle is its most recent font
  const handleLastmod = new Map<string, string | null>();
  for (const f of fonts) {
    if (!slugSafe(f.maker_handle) || handleLastmod.has(f.maker_handle)) continue;
    handleLastmod.set(f.maker_handle, isoDate(f.created_at));
  }

  const newest = isoDate(fonts[0]?.created_at);
  type Entry = { loc: string; lastmod: string | null };
  const entries: Entry[] = [
    { loc: `${origin}/`, lastmod: newest },
    { loc: `${origin}/make`, lastmod: null },
    { loc: `${origin}/faq`, lastmod: null },
    { loc: `${origin}/licenses`, lastmod: null },
    { loc: `${origin}/terms`, lastmod: null },
    { loc: `${origin}/privacy`, lastmod: null },
    ...fonts.map((f) => ({ loc: `${origin}/f/${f.id}`, lastmod: isoDate(f.created_at) })),
    ...[...handleLastmod.entries()].map(([h, lastmod]) => ({
      loc: `${origin}/u/${encodeURIComponent(h)}`,
      lastmod,
    })),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map(
        (e) =>
          `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`,
      )
      .join('\n') +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
