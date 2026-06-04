// Real font-signature detection from the leading bytes, so the publish gate
// never trusts a client-declared content type. OTF is 'OTTO' or the version
// 0x00010000; TTF is 0x00010000, 'true', or a collection 'ttcf'; WOFF2 is 'wOF2'.

const tag4 = (u: Uint8Array) => String.fromCharCode(u[0], u[1], u[2], u[3]);
const u32 = (u: Uint8Array) => ((u[0] << 24) | (u[1] << 16) | (u[2] << 8) | u[3]) >>> 0;

export const isOtf = (u: Uint8Array) => tag4(u) === 'OTTO' || u32(u) === 0x00010000;
export const isTtf = (u: Uint8Array) => u32(u) === 0x00010000 || tag4(u) === 'true' || tag4(u) === 'ttcf';
export const isWoff2 = (u: Uint8Array) => tag4(u) === 'wOF2';
