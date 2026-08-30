/**
 * Where heylook lives, as one value.
 *
 * The server runs on whichever machine on the network has the GPU, so the
 * origin cannot be a constant the way Gemini's is. It also cannot be a text
 * field in the UI: the page's `connect-src` names literal hosts, so a base URL
 * typed at runtime that the policy does not name is refused by the browser
 * before the request leaves, with no status code and no response -- the worst
 * failure shape available.
 *
 * So it is configured once, at build time, and the CSP is generated FROM this
 * value rather than maintained alongside it (see `heylookCsp` in
 * vite.config.ts). The two cannot disagree, because there is only one of them.
 *
 * Set it in `.env` as VITE_HEYLOOK_ORIGIN. The VITE_ prefix is required for
 * Vite to expose it, and is safe here in a way GEMINI_API_KEY is not: this is
 * a hostname, not a secret, and it has to reach the browser to be of any use.
 *
 * Scheme note that no CSP entry can help with: a plain `http://` origin that is
 * not localhost is blocked as mixed content when the page itself is served over
 * https, whatever the policy says. Over the http dev server both work.
 */

const FALLBACK_ORIGIN = 'http://localhost:8000';

/**
 * Trailing slashes are stripped so that `${origin}/v1/models` never doubles up.
 * A doubled slash is accepted by most routers and rejected by some, which makes
 * it the kind of difference that shows up once, in production, on one machine.
 */
function normalizeOrigin(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return FALLBACK_ORIGIN;
  return trimmed.replace(/\/+$/, '');
}

export { FALLBACK_ORIGIN, normalizeOrigin };
