// Transactional email via the Resend HTTP API. Cloudflare Workers cannot open
// SMTP connections, so all outbound mail goes through an HTTPS API. Sends from a
// verified fonthead.dev address; replies to support@ forward to the team inbox.
//
// Never throws: a send failure (bad key, domain not yet verified, Resend down)
// returns false so it cannot break the request that triggered it. The caller
// logs and moves on, and the user still sees the generic "check your email" copy
// (which also avoids leaking whether an address has an account).

const FROM = 'fonthead <support@fonthead.dev>';

export async function sendResetEmail(env: Env, to: string, url: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;

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

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject: 'Reset your fonthead password', text, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
