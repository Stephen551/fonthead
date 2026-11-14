# 0085 — Strip location and other metadata from avatars before they are stored

Status: Accepted

## Context

`updateProfile` (`src/actions/index.ts`) checked an avatar's magic bytes and size, then wrote the uploaded bytes to R2 unchanged, and `/cdn/avatars/` serves them publicly. A JPEG straight off a phone carries EXIF, often with GPS coordinates, so a member who used a phone photo as their avatar could publish where they live. The bug-report sheet never had this problem because it is redrawn through a canvas before upload (`src/components/Maker.tsx`, `bugSheet()`).

## Decision

Strip metadata in two places.

- **Server, the guarantee:** `src/lib/image-metadata.ts` exports `stripImageMetadata(bytes, ext)`, and `updateProfile` stores only its output. It walks the container and copies the image data untouched, so nothing is re-encoded.
  - JPEG: drops APP1 (Exif and XMP), APP13 (Photoshop/IPTC), COM, the APP2 MPF index, and everything after EOI (MPF secondary images carry their own EXIF). Keeps APP0, the APP2 ICC profile, APP14, tables, frames and every scan, walking entropy data past byte stuffing and restart markers.
  - PNG: drops eXIf, tEXt, iTXt, zTXt, tIME and anything after IEND.
  - WebP: drops the EXIF and XMP chunks, clears their VP8X flags, rewrites the RIFF size and drops anything past it.
  - Anything the parser cannot walk throws `ImageMetadataError`, and the upload is rejected with "That image could not be read". The original bytes are never stored.
- **Browser, for smaller files and the right way up:** `src/pages/account.astro` redraws the chosen avatar through a canvas (long edge capped at 512 px) and uploads it as WebP. `createImageBitmap` applies the photo's EXIF rotation, so the redraw bakes it in before the EXIF goes. If the browser cannot decode the file, the original goes up and the server decides.
- **Avatars already stored:** `scripts/strip-avatar-metadata.mjs` lists avatar keys from the user table, runs each object through the same helper, and prints what it would change. It is a dry run unless given `--write`, and it has not been run against production. JPEGs whose EXIF asks for a rotation are reported and never rewritten, because stripping the EXIF would turn them sideways; those members can re-upload.

## Alternatives rejected

- Browser redraw only: a direct POST to the action skips it, so it cannot be the guarantee.
- Re-encoding on the server: Workers have no image codec without a WASM dependency or the paid Images binding, and stripping blocks is enough.
- Allowlisting only the blocks a decoder needs: dropping the ICC profile would shift colors, and the known metadata blocks are a short, stable list.

## Consequences

- Server stripping also drops the EXIF rotation tag. Uploads through the account page are already rotated by the redraw, so this only affects a JPEG the browser could not decode or one posted without the page.
- Avatars are edge-cached for up to a day (`cache-control: public, max-age=86400`), so a backfilled avatar can show the old bytes from the cache until that runs out.

## Evidence

- `test/image-metadata.test.ts`: real and Pillow-made JPEG, PNG and WebP fixtures, checked byte for byte against the same image saved without metadata.
- Gemini code review checked against the code on 2026-11-11 (avatar EXIF finding).
