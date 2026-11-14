/**
 * Small WebCrypto helpers for end-to-end encrypted rooms.
 *
 * The room secret lives only in the invite link's #fragment, which browsers
 * never send to any server. Every message is sealed with AES-256-GCM using a
 * key derived (HKDF-SHA-256) from that secret, so neither GitHub, the PeerJS
 * broker, nor a relay can read or forge messages — only someone holding the
 * full invite link can.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const utf8 = (bytes) => dec.decode(bytes);
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function sha256b64u(text) {
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function deriveRoomKey(secret, code) {
  const ikm = await crypto.subtle.importKey('raw', unb64u(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(`focusroom-v2|${code}`), info: enc.encode('room-message-key') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** encrypt a JSON-able object; aad binds the envelope (sender + sequence) */
export async function seal(key, obj, aad) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64u(iv), ct: b64u(ct) };
}

/** decrypt; throws if the key is wrong or anything was tampered with */
export async function unseal(key, box, aad) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(box.iv), additionalData: enc.encode(aad) }, key, unb64u(box.ct));
  return JSON.parse(dec.decode(pt));
}
