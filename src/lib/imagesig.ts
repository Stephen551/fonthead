// Image signature detection by magic bytes, mirroring fontsig.ts. The client's
// declared type is never trusted. SVG is intentionally excluded: it can carry
// script, and an avatar never needs it.

export const isPng = (u: Uint8Array) =>
  u.length > 8 &&
  u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47 &&
  u[4] === 0x0d && u[5] === 0x0a && u[6] === 0x1a && u[7] === 0x0a;

export const isJpeg = (u: Uint8Array) => u.length > 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff;

export const isWebp = (u: Uint8Array) =>
  u.length > 12 &&
  u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && // "RIFF"
  u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50; // "WEBP"

/** The avatar file extension for a recognized image, or null if unrecognized. */
export function imageExt(u: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  if (isPng(u)) return 'png';
  if (isJpeg(u)) return 'jpg';
  if (isWebp(u)) return 'webp';
  return null;
}

export const MIN_AVATAR_BYTES = 64;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export const AVATAR_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};
