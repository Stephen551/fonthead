import { useEffect, useRef, useState, type FormEvent } from 'react';
import { actions } from 'astro:actions';
import { claimReviewPrompt, REVIEW_PUBLIC_PERMISSION } from '../lib/reviews';

export default function ReviewPrompt({ downloads }: { downloads: number }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [allowPublic, setAllowPublic] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const reviewId = useRef('');
  const sendingRef = useRef(false);

  useEffect(() => {
    if (downloads > 0 && claimReviewPrompt()) {
      reviewId.current = crypto.randomUUID();
      setOpen(true);
    }
  }, [downloads]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sendingRef.current) return;
    if (!rating) { setError('Choose a rating first.'); return; }
    const website = String(new FormData(e.currentTarget).get('website') || '');
    sendingRef.current = true;
    setSending(true);
    setError('');
    try {
      const { error: failure } = await actions.submitMakerReview({
        id: reviewId.current, rating, message: message.trim(), allowPublic, website,
      });
      if (failure) {
        setError(failure.message || 'Could not send your review. Please try again.');
      } else {
        setSent(true);
      }
    } catch {
      setError('Could not send your review. Please try again.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  if (!open) return null;
  if (sent) return <p role="status" className="fh-mono" style={{ marginTop: 18, fontSize: 12, color: 'var(--ink-soft)' }}>Thanks for reviewing Fonthead.</p>;

  return (
    <form onSubmit={submit} aria-label="Review your font-making experience" style={{ marginTop: 18, padding: 16, border: '1px solid var(--line-2)', borderRadius: 3, background: 'var(--paper)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ fontSize: 16, margin: 0, color: 'var(--ink)' }}>How was making your font?</h3>
      <p role="status" style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, margin: 0 }}>Your download has started. Leave a quick review of the maker, if you like.</p>
      <fieldset disabled={sending} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="fh-mono" style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 8 }}>Your rating</legend>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5].map(n => (
            <label key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 44, padding: '6px 4px', border: '1px solid var(--line-2)', borderRadius: 2, cursor: 'pointer', color: n <= rating ? 'var(--ink)' : 'var(--ink-faint)' }}>
              <span aria-hidden="true" style={{ fontSize: 24, lineHeight: 1 }}>{n <= rating ? '★' : '☆'}</span>
              <input type="radio" name="maker-review-rating" value={n} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`} required checked={rating === n} onChange={() => setRating(n)} />
            </label>
          ))}
        </div>
      </fieldset>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--ink-soft)' }}>
        Your review (optional)
        <textarea className="fh-input" rows={3} maxLength={2000} disabled={sending} value={message} onChange={e => setMessage(e.target.value)} placeholder="What worked or felt frustrating?" style={{ resize: 'vertical', width: '100%' }} />
      </label>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
        <input type="checkbox" checked={allowPublic} disabled={sending} onChange={e => setAllowPublic(e.target.checked)} style={{ marginTop: 3 }} />
        <span>{REVIEW_PUBLIC_PERMISSION}</span>
      </label>
      <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: 0, lineHeight: 1.5 }}>Leave the box unchecked to share only with the Fonthead team.</p>
      <input name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
      {error && <p role="alert" style={{ color: 'var(--signal)', fontSize: 12, margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button className="fh-btn" type="submit" disabled={sending}>{sending ? 'sending…' : 'send review'}</button>
        <button className="fh-btn fh-btn--ghost" type="button" disabled={sending} onClick={() => setOpen(false)}>no thanks</button>
      </div>
    </form>
  );
}
