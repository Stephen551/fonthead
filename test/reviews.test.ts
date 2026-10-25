import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('first-download review prompt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    localStorage.clear();
  });

  it('claims the prompt once, including after a page reload', async () => {
    const first = await import('../src/lib/reviews');
    expect(first.claimReviewPrompt()).toBe(true);
    expect(first.claimReviewPrompt()).toBe(false);
    vi.resetModules();
    const reloaded = await import('../src/lib/reviews');
    expect(reloaded.claimReviewPrompt()).toBe(false);
  });

  it('does not ask again when a previous visit already showed it', async () => {
    const reviews = await import('../src/lib/reviews');
    localStorage.setItem(reviews.REVIEW_PROMPT_KEY, '1');
    expect(reviews.claimReviewPrompt()).toBe(false);
  });

  it('does not break downloads or repeat in-session when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const reviews = await import('../src/lib/reviews');
    expect(reviews.claimReviewPrompt()).toBe(true);
    expect(reviews.claimReviewPrompt()).toBe(false);
  });

  it('keeps the visit guard if writing storage fails', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const reviews = await import('../src/lib/reviews');
    expect(reviews.claimReviewPrompt()).toBe(true);
    expect(reviews.claimReviewPrompt()).toBe(false);
  });
});
