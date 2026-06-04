import { describe, it, expect } from 'vitest';
import { rateLimit } from '../src/lib/ratelimit';
import { isOtf, isTtf, isWoff2 } from '../src/lib/fontsig';
import { isAdminEmail, escapeJsonForScript } from '../src/lib/util';

// Minimal in-memory KV double: enough surface for the fixed-window limiter.
function fakeKv() {
  const store = new Map<string, string>();
  return {
    async get(k: string) {
      return store.has(k) ? store.get(k)! : null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
}

describe('rateLimit', () => {
  it('allows up to the limit then blocks within the window', async () => {
    const kv = fakeKv();
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push(await rateLimit(kv, 'user-1', 3, 60));
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('tracks distinct keys independently', async () => {
    const kv = fakeKv();
    expect(await rateLimit(kv, 'a', 1, 60)).toBe(true);
    expect(await rateLimit(kv, 'a', 1, 60)).toBe(false);
    expect(await rateLimit(kv, 'b', 1, 60)).toBe(true);
  });
});

const tag = (s: string) => new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
const ver1 = () => new Uint8Array([0x00, 0x01, 0x00, 0x00]);

describe('font signature detection', () => {
  it('accepts real OTF / TTF / WOFF2 signatures', () => {
    expect(isOtf(tag('OTTO'))).toBe(true);
    expect(isOtf(ver1())).toBe(true);
    expect(isTtf(ver1())).toBe(true);
    expect(isTtf(tag('true'))).toBe(true);
    expect(isWoff2(tag('wOF2'))).toBe(true);
  });

  it('rejects mislabeled or junk bytes', () => {
    expect(isOtf(tag('wOF2'))).toBe(false); // a woff2 is not an otf
    expect(isWoff2(tag('OTTO'))).toBe(false);
    expect(isOtf(tag('%PDF'))).toBe(false);
    expect(isTtf(tag('%PDF'))).toBe(false);
  });
});

describe('isAdminEmail', () => {
  it('matches case-insensitively and tolerates whitespace', () => {
    const list = 'a@x.com, Boss@Y.com ';
    expect(isAdminEmail(list, 'boss@y.com')).toBe(true);
    expect(isAdminEmail(list, 'A@X.com')).toBe(true);
  });

  it('denies non-admins, empty list, and empty email', () => {
    expect(isAdminEmail('a@x.com', 'b@x.com')).toBe(false);
    expect(isAdminEmail('', 'a@x.com')).toBe(false);
    expect(isAdminEmail(undefined, 'a@x.com')).toBe(false);
    expect(isAdminEmail('a@x.com', null)).toBe(false);
  });
});

describe('escapeJsonForScript (hero data-island XSS guard)', () => {
  it('neutralises a </script> breakout in a user-controlled font name', () => {
    const faces = [{ name: '</script><img src=x onerror=alert(1)>', family: 'fh-x' }];
    const out = escapeJsonForScript(JSON.stringify(faces));
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
  });

  it('round-trips through JSON.parse unchanged (the client reads it back)', () => {
    const faces = [{ name: 'A & B </script> <weird>', designer: 'x>y' }];
    expect(JSON.parse(escapeJsonForScript(JSON.stringify(faces)))).toEqual(faces);
  });

  it('leaves ordinary names untouched', () => {
    const faces = [{ name: 'AC Flames', designer: 'a-c-meridian' }];
    const out = escapeJsonForScript(JSON.stringify(faces));
    expect(JSON.parse(out)).toEqual(faces);
    expect(out).not.toContain('\\u');
  });
});
