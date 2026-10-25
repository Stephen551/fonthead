export const REVIEW_PROMPT_KEY = 'fh-maker-review-prompted-v1';
export const REVIEW_PUBLIC_PERMISSION = 'You may show my rating and review publicly on Fonthead, without my name.';

// Storage is best-effort: private browsing must never block a font download.
// The module guard also prevents repeated prompts if localStorage is unavailable.
let promptedThisVisit = false;
export function claimReviewPrompt(): boolean {
  if (promptedThisVisit) return false;
  promptedThisVisit = true;
  try {
    if (localStorage.getItem(REVIEW_PROMPT_KEY)) return false;
    localStorage.setItem(REVIEW_PROMPT_KEY, '1');
  } catch {
    // Keep the in-memory guard when the browser refuses persistent storage.
  }
  return true;
}
