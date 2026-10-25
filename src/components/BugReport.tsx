import { useEffect, useState, type FormEvent } from 'react';
import { actions } from 'astro:actions';

// The in-maker bug report (ADR 0060). A quiet link under the build readout, and
// an open, plainly worded prompt when a build has just failed, since that is the
// moment people are willing to say what happened. The maker's context rides
// along automatically; the sheet is attached only if the person ticks the box.
export default function BugReport({
  failed,
  hasSheet,
  getContext,
  getSheet,
}: {
  failed: boolean;
  hasSheet: boolean;
  getContext: () => Record<string, unknown>;
  getSheet: () => Promise<Blob | null>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [attach, setAttach] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);

  // a fresh failure reopens the prompt, even after an earlier report was sent
  useEffect(() => {
    if (failed) {
      setOpen(true);
      setSent(false);
      setMsg('');
    }
  }, [failed]);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('message', note.trim());
    fd.set('email', email.trim());
    fd.set('context', JSON.stringify(getContext()));
    setSending(true);
    setMsg('');
    try {
      if (attach && hasSheet) {
        const blob = await getSheet();
        if (blob) fd.set('sheet', new File([blob], 'sheet.jpg', { type: blob.type || 'image/jpeg' }));
      }
      const { error } = await actions.submitBugReport(fd);
      if (error) {
        setMsg(error.message || 'Could not send. Try again in a moment.');
        return;
      }
      setSent(true);
      setNote('');
      setAttach(false);
      setMsg('');
    } catch {
      setMsg('Could not send. Try again in a moment.');
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <p data-testid="bug-done" className="fh-mono" style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 18, lineHeight: 1.6 }}>
        Thanks, we got it. {email.trim() ? 'We will write back.' : 'It goes straight to the person who builds fonthead.'}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fh-mono"
        style={{ marginTop: 18, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, color: 'var(--ink-faint)', textDecoration: 'underline', textUnderlineOffset: 3 }}
      >
        something wrong? tell us
      </button>
    );
  }

  return (
    <form
      onSubmit={send}
      aria-label="Report a problem"
      style={{ marginTop: 18, padding: '14px 16px', border: '1px solid var(--line-2)', borderRadius: 3, background: 'var(--paper)', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <p className="fh-mono" style={{ fontSize: 12, color: 'var(--ink)', margin: 0, lineHeight: 1.5 }}>
        {failed
          ? "That didn't build. Tell us what happened and we'll fix it."
          : 'Something look wrong? Tell us and we will fix it.'}
      </p>
      <textarea
        aria-label="What went wrong"
        className="fh-input"
        rows={3}
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={failed ? 'what you expected (optional)' : 'what went wrong'}
        style={{ resize: 'vertical', fontFamily: 'var(--sans)' }}
      />
      <label className="fh-mono" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11.5, color: hasSheet ? 'var(--ink-soft)' : 'var(--ink-faint)', lineHeight: 1.5, cursor: hasSheet ? 'pointer' : 'not-allowed' }}>
        <input type="checkbox" checked={attach} disabled={!hasSheet} onChange={(e) => setAttach(e.target.checked)} style={{ marginTop: 2 }} />
        <span>
          {hasSheet
            ? 'attach my sheet. It is the fastest way for us to see what broke. Only the fonthead team sees it, and it is deleted once the report is closed.'
            : 'drop a sheet first to attach it'}
        </span>
      </label>
      <input
        aria-label="Email (optional)"
        type="email"
        className="fh-input"
        autoComplete="email"
        maxLength={200}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email, if you want a reply (optional)"
      />
      {/* honeypot: hidden from people, tempting to bots; a filled value is dropped */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
      <p className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', margin: 0, lineHeight: 1.5 }}>
        We also send the build settings and your browser type, so you do not have to explain them.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="fh-btn" disabled={sending}>
          {sending ? 'sending…' : 'send report'}
        </button>
        {!failed && (
          <button type="button" className="fh-btn fh-btn--ghost" disabled={sending} onClick={() => setOpen(false)}>
            cancel
          </button>
        )}
        <span role="status" aria-live="polite" className="fh-mono" style={{ fontSize: 11.5, color: 'var(--signal)' }}>{msg}</span>
      </div>
    </form>
  );
}
