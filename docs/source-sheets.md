# Published font source sheets

New publishes save the original PNG, JPEG, or WebP sheets used by the build in
the existing private R2 `fonthead-fonts` bucket. Each sheet can be up to 10 MB.
The base sheet, up to two variation sheets, and an optional accents supplement are saved without resizing or
re-encoding, including any embedded image metadata. Built-in samples save their
generated full-size PNG instead. Building or downloading alone uploads nothing.
The action request limit is 60 MB to accommodate sheets, font files, and the
share card; the publish action still enforces each file's individual limit.

Take the font ID from its `/f/<font-id>` URL. In the Cloudflare R2 dashboard,
open `fonthead-fonts` and look under `sources/<font-id>/`:

```text
sources/<font-id>/base.png
sources/<font-id>/variation-1.jpg
sources/<font-id>/variation-2.webp
sources/<font-id>/supplement.png
```

Extensions reflect the actual image format, so they can differ from this
example or from the original filename. In D1 `fonthead`, the `fonts.meta` JSON
contains a `sourceSheets` array with each object's `key`, `role`, `contentType`,
and `size` in bytes. Query it in the D1 console:

```sql
SELECT id, name, json_extract(meta, '$.sourceSheets') AS source_sheets
FROM fonts
WHERE id = '<font-id>';
```

With Cloudflare credentials, download an object using its recorded key:

```powershell
npx wrangler r2 object get "fonthead-fonts/sources/<font-id>/base.png" --remote --file "alphabet-sheet.png"
```

The public `/cdn/` route does not serve source sheets, including for public
fonts. No public bucket URL should be enabled for this bucket. Retrieval is
through the R2 dashboard or authenticated Cloudflare tooling.

Renaming a font keeps its source references. Owner deletion, admin takedown, and
account deletion attempt to remove its sheets alongside the font files. Failed
publishes roll back their R2 writes. Like the existing font cleanup, deletion
is best effort if R2 is unavailable.

Older published fonts have no recoverable sheets unless someone still has the
original files. Older maker clients must reload to complete the new mapping and
spacing review before publishing. Newly built
font files embed `Fonthead` attribution and `https://fonthead.dev` URLs; existing
published binaries are not rewritten.
