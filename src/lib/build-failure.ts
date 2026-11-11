// Keep diagnostic text bounded. Browser errors can quote a URL containing a
// blob handle, image data or query string. Only the message belongs in D1.
export function buildFailureMessage(message: string): string {
  return message.replace(/(?:data:|blob:|https?:\/\/|file:\/\/)[^\s"'<>]+/gi, '[URL]')
    .replace(/\s+/g, ' ').trim().slice(0, 1000) || 'No error message provided.';
}
