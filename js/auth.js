/**
 * Sign in with Google for study rooms — no backend needed.
 *
 * Each person signs in with Google Identity Services and gets an ID token
 * (a JWT signed by Google). Inside the encrypted room channel they exchange
 * tokens, and each browser checks the other's token itself: Google's RSA
 * signature (keys fetched from Google), issuer, audience (this app's client
 * ID), expiry, verified email, and a nonce bound to this specific room, so a
 * token can't be reused anywhere else.
 */
import { b64u, unb64u, utf8 } from './crypto.js?v=20261121e';

// Public OAuth Web client ID (not a secret). Paste yours here.
export const GOOGLE_CLIENT_ID = '851506894285-25uvrujj9rt65nuilm5sh22do5aqqiqe.apps.googleusercontent.com';

const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
// Local automated tests only: a fake issuer + keys served by the test server.
export const TEST = IS_LOCAL && new URLSearchParams(location.search).get('authtest') === '1';

const CFG = TEST
  ? { clientId: 'focusroom-test-client', issuers: ['https://issuer.test'], jwks: '/__test__/jwks.json' }
  : { clientId: GOOGLE_CLIENT_ID, issuers: ['accounts.google.com', 'https://accounts.google.com'], jwks: 'https://www.googleapis.com/oauth2/v3/certs' };

export const authConfigured = () => TEST || /\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID);

export class AuthError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export function decodeJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new AuthError('malformed');
  try {
    return { header: JSON.parse(utf8(unb64u(parts[0]))), payload: JSON.parse(utf8(unb64u(parts[1]))), parts };
  } catch { throw new AuthError('malformed'); }
}

/** seconds until a token expires (negative = expired) */
export function tokenTtl(token) {
  try { return decodeJwt(token).payload.exp - Date.now() / 1000; } catch { return -1; }
}

export function profileFromToken(token) {
  try {
    const p = decodeJwt(token).payload;
    return { sub: p.sub, email: p.email, name: p.name || p.email, givenName: p.given_name || p.name, picture: safePicture(p.picture) };
  } catch { return null; }
}

function safePicture(url) {
  return typeof url === 'string' && /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(url) && url.length < 600 ? url : '';
}

let jwks = { at: 0, keys: [] };
async function getKey(kid) {
  const fresh = Date.now() - jwks.at < 3600e3;
  let jwk = fresh && jwks.keys.find((k) => k.kid === kid);
  if (!jwk) {
    const res = await fetch(CFG.jwks, { cache: 'no-cache', credentials: 'omit' });
    if (!res.ok) throw new AuthError('keys-unavailable', 'Couldn’t reach Google to check sign-in');
    jwks = { at: Date.now(), keys: (await res.json()).keys || [] };
    jwk = jwks.keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new AuthError('unknown-key');
  return crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/**
 * Verify a friend's Google ID token in the browser.
 * @param {string} token
 * @param {{nonce: string, allow?: string[]}} opts allow = optional list of permitted emails
 */
export async function verifyIdToken(token, { nonce, allow = [] }) {
  if (typeof token !== 'string' || token.length > 4096) throw new AuthError('malformed');
  const { header, payload, parts } = decodeJwt(token);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('bad-alg');
  const key = await getKey(header.kid);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new AuthError('bad-signature', 'Sign-in signature is invalid');
  const now = Date.now() / 1000;
  if (!CFG.issuers.includes(payload.iss)) throw new AuthError('bad-issuer');
  if (payload.aud !== CFG.clientId) throw new AuthError('bad-audience', 'Signed in to a different app');
  if (!(payload.exp > now - 60)) throw new AuthError('expired', 'Google sign-in expired');
  if (typeof payload.iat === 'number' && payload.iat > now + 300) throw new AuthError('bad-iat');
  if (payload.email_verified !== true || typeof payload.email !== 'string') throw new AuthError('unverified-email');
  if (payload.nonce !== nonce) throw new AuthError('wrong-room', 'Signed in for a different room');
  const email = payload.email.toLowerCase();
  const list = allow.map((e) => e.toLowerCase().trim()).filter(Boolean);
  if (list.length && !list.includes(email)) throw new AuthError('not-allowed', 'This room is locked to a different Google account');
  return { sub: String(payload.sub), email, name: String(payload.name || email).slice(0, 60), givenName: String(payload.given_name || payload.name || email).slice(0, 40), picture: safePicture(payload.picture) };
}

/* ---------------- sign-in UI ---------------- */
let gsi;
export function loadGsi() {
  gsi ||= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gsi = null; reject(new AuthError('gsi-load', 'Couldn’t load Google sign-in')); };
    document.head.append(s);
  });
  return gsi;
}

/**
 * Render a "Continue with Google" button bound to a room nonce.
 * onToken(idToken) fires after sign-in. Returns a cleanup function.
 */
// the Google account already used for sync, so the room sign-in offers that one first
let hint = '';
export function setSignInHint(email) { hint = email || ''; }

export async function renderSignIn(container, nonce, onToken) {
  container.innerHTML = '';
  if (TEST) {
    const b = document.createElement('button');
    b.className = 'btn solid';
    b.textContent = 'Continue with Google (test)';
    b.id = 'test-signin';
    b.onclick = () => { const t = window.__testTokenFor?.(nonce); if (t) onToken(t); };
    container.append(b);
    return;
  }
  if (!authConfigured()) throw new AuthError('not-configured', 'Google sign-in isn’t set up yet');
  await loadGsi();
  window.google.accounts.id.initialize({
    client_id: CFG.clientId,
    nonce,
    callback: (r) => r?.credential && onToken(r.credential),
    auto_select: true,
    login_hint: hint || undefined,
    cancel_on_tap_outside: false,
    itp_support: true,
    use_fedcm_for_prompt: true,
    context: 'signin',
  });
  window.google.accounts.id.renderButton(container, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', width: 290 });
}

/** try a silent / one-tap re-sign-in for the same room nonce */
export async function promptSignIn(nonce, onToken) {
  if (TEST) { const t = window.__testTokenFor?.(nonce); if (t) onToken(t); return; }
  if (!authConfigured()) return;
  await loadGsi();
  window.google.accounts.id.initialize({ client_id: CFG.clientId, nonce, callback: (r) => r?.credential && onToken(r.credential), auto_select: true, login_hint: hint || undefined, use_fedcm_for_prompt: true, itp_support: true });
  window.google.accounts.id.prompt();
}

export function signOut() {
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* noop */ }
}

export const roomNonceInput = (code, secret) => `focusroom-v2|${code}|${secret}`;
export { b64u };
