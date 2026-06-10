// Transactional email via the Resend HTTP API. Cloudflare Workers cannot open
// SMTP connections, so all outbound mail goes through an HTTPS API. Sends from a
// verified fonthead.dev address; replies to support@ forward to the team inbox.
//
// Never throws: a send failure (bad key, domain not yet verified, Resend down)
// returns false so it cannot break the request that triggered it. The caller
// logs and moves on, and the user still sees the generic "check your email" copy
// (which also avoids leaking whether an address has an account).

const FROM = 'fonthead <support@fonthead.dev>';
const SUPPORT = 'support@fonthead.dev';

// One place that talks to Resend. Returns false on a missing key or any failure
// so a caller can never be broken by a send problem.
async function resendSend(env: Env, payload: Record<string, unknown>): Promise<boolean> {
  // dry-run guard: local dev + the e2e suite run with the real key in
  // .dev.vars, and every suite run was mailing the real support inbox and
  // bouncing @example.test confirmations. Pretend success, send nothing.
  if (env.EMAIL_DRY_RUN) return true;
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, ...payload }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendResetEmail(env: Env, to: string, url: string): Promise<boolean> {
  const text = [
    'Someone asked to reset the password for your fonthead.dev account.',
    '',
    'Open this link to set a new one:',
    url,
    '',
    'The link expires in an hour. If you did not ask for this, you can ignore this',
    'email and your password stays the same.',
  ].join('\n');

  const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#15140f;max-width:520px;">
  <p>Someone asked to reset the password for your fonthead.dev account.</p>
  <p><a href="${url}" style="display:inline-block;background:#15140f;color:#fff;text-decoration:none;padding:11px 18px;border-radius:2px;">Set a new password</a></p>
  <p style="font-size:13px;color:#75726a;">Or paste this link into your browser:<br><a href="${url}" style="color:#75726a;">${url}</a></p>
  <p style="font-size:13px;color:#75726a;">The link expires in an hour. If you did not ask for this, you can ignore this email and your password stays the same.</p>
</div>`;

  return resendSend(env, { to, subject: 'Reset your fonthead password', text, html });
}

export async function sendVerificationEmail(env: Env, to: string, url: string): Promise<boolean> {
  const text = [
    'Confirm your email to finish setting up your fonthead.dev account.',
    '',
    'Open this link to confirm:',
    url,
    '',
    'Confirming lets you sign in with Google using this same email later. The link',
    'expires in an hour. If you did not create this account, you can ignore this email.',
  ].join('\n');

  const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#15140f;max-width:520px;">
  <p>Confirm your email to finish setting up your fonthead.dev account.</p>
  <p><a href="${url}" style="display:inline-block;background:#15140f;color:#fff;text-decoration:none;padding:11px 18px;border-radius:2px;">Confirm your email</a></p>
  <p style="font-size:13px;color:#75726a;">Or paste this link into your browser:<br><a href="${url}" style="color:#75726a;">${url}</a></p>
  <p style="font-size:13px;color:#75726a;">Confirming lets you sign in with Google using this same email later. The link expires in an hour. If you did not create this account, you can ignore it.</p>
</div>`;

  return resendSend(env, { to, subject: 'Confirm your fonthead email', text, html });
}

// A support / bug report from the /support form. Goes to the support inbox with
// the reporter's email as reply-to, so a reply from Gmail reaches them.
export async function sendFeedbackEmail(
  env: Env,
  opts: { kind: string; message: string; replyTo?: string; page?: string; account?: string },
): Promise<boolean> {
  const text = [
    `Kind: ${opts.kind}`,
    opts.page ? `Page: ${opts.page}` : null,
    opts.account ? `Account: ${opts.account}` : null,
    `Reply to: ${opts.replyTo || '(not provided)'}`,
    '',
    opts.message,
  ]
    .filter((l) => l !== null)
    .join('\n');
  const snippet = opts.message.replace(/\s+/g, ' ').trim().slice(0, 60);
  return resendSend(env, {
    to: SUPPORT,
    subject: `fonthead ${opts.kind}: ${snippet}`,
    text,
    ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
  });
}
