// Dynamic sitemap: static routes plus every public font page and maker profile,
// so search engines can discover /f/:id and /u/:handle.
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  const env = locals.runtime.env;
  const origin = url.origin;
  const rows = await env.DB.prepare(
    "SELECT id, maker_handle FROM fonts WHERE visibility = 'public' ORDER BY created_at DESC LIMIT 5000",
  ).all<{ id: string; maker_handle: string }>();
  const fonts = rows.results ?? [];
  const handles = [...new Set(fonts.map((f) => f.maker_handle))];

  const locs = [
    `${origin}/`,
    `${origin}/make`,
    `${origin}/faq`,
    ...fonts.map((f) => `${origin}/f/${f.id}`),
    ...handles.map((h) => `${origin}/u/${h}`),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    locs.map((loc) => `  <url><loc>${loc}</loc></url>`).join('\n') +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
