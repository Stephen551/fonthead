import type { APIRoute } from 'astro';

export const prerender = false;

// /llms.txt: a plain-text map for AI engines. Curated, truthful, and short.
// Mirrors the robots.txt / sitemap.xml route pattern.
export const GET: APIRoute = ({ url }) => {
  const o = url.origin;
  const body = `# fonthead.dev

> A community font library and maker. Trace an alphabet sheet into a real, installable font in your browser, publish it to the wall, and browse what others make. Nothing leaves your browser while you build.

## Pages
- [Library](${o}/): browse and vote on fonts the community has made
- [Maker](${o}/make): trace an alphabet sheet into an OTF, TTF, or WOFF2 font, monochrome or color
- [Sign in](${o}/sign-in): an account holds your fonts, favorites, and what you publish
- [Licenses](${o}/licenses): what OFL, CC0, and personal-use mean for a published font
- [Terms](${o}/terms): acceptable use, what you agree to when you publish, moderation
- [Privacy](${o}/privacy): what stays in your browser, what is stored, how to delete your data

## About
fonthead.dev is built by A&C Meridian. The maker runs entirely client-side. Tracing, font assembly, and woff2 compression all happen in your browser, so your source images and fonts are not uploaded while you build.
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
