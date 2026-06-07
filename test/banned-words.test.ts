import { describe, it, expect } from 'vitest';
import { containsBannedWord } from '../src/lib/banned-words';

describe('containsBannedWord', () => {
  it('passes clean handles and font names', () => {
    for (const ok of ['anton', 'pacifico', 'my cool font', 'midnight-slab', 'AC Flames', 'handmade', 'g']) {
      expect(containsBannedWord(ok)).toBe(false);
    }
  });

  it('does not false-positive on innocent words that embed an exact-list slur', () => {
    // the Scunthorpe set: these contain coon/spic/pedo/chink/rapist as substrings
    for (const ok of ['raccoon', 'cocoon', 'tycoon', 'spicy', 'auspicious', 'torpedo', 'speedo', 'therapist', 'chink in the armor']) {
      expect(containsBannedWord(ok)).toBe(false);
    }
  });

  it('blocks an exact-list slur on its own', () => {
    for (const bad of ['coon', 'spic', 'pedo', 'chink', 'rapist']) {
      expect(containsBannedWord(bad)).toBe(true);
    }
  });

  it('blocks substring slurs anywhere in the string', () => {
    for (const bad of ['nigger', 'xXfaggotXx', 'so_kike_lol', 'wetback']) {
      expect(containsBannedWord(bad)).toBe(true);
    }
  });

  it('catches leetspeak and spaced/punctuated evasions', () => {
    for (const bad of ['n1gg3r', 'f4gg0t', 'f a g g o t', 'n-i-g-g-a', 'k1k3']) {
      expect(containsBannedWord(bad)).toBe(true);
    }
  });

  it('handles empty / falsy input', () => {
    expect(containsBannedWord('')).toBe(false);
    expect(containsBannedWord('   ')).toBe(false);
  });
});
