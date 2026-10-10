// Short-lived, host-only reviewer sessions. The credential remains server-side;
// the browser receives a signed HttpOnly token scoped to the reviewer role.
import { timingSafeEqualSecret } from './_crypto.js';

export const REVIEW_COOKIE = '__Host-topman-review';
export const REVIEW_SESSION_SECONDS = 15 * 60;
const encoder = new TextEncoder();

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(`topman-review-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export function isSameOriginReviewRequest(request) {
  return request.headers.get('origin') === new URL(request.url).origin
    && request.headers.get('sec-fetch-site') !== 'cross-site';
}
export async function isReviewerBearer(request, secret) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;
  const candidate = authorization.slice(7);
  return candidate.length <= 512 && timingSafeEqualSecret(candidate, secret);
}
export async function issueReviewSession(request, secret, nowMs = Date.now()) {
  if (!secret) return null;
  const expiresAt = nowMs + REVIEW_SESSION_SECONDS * 1000;
  const payload = encode(encoder.encode(JSON.stringify({ role: 'reviewer', aud: new URL(request.url).origin, exp: expiresAt, nonce: crypto.randomUUID() })));
  const signature = encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload))));
  return { token: `${payload}.${signature}`, expiresAt };
}
export async function readReviewSession(request, secret, nowMs = Date.now()) {
  if (!secret) return null;
  const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${REVIEW_COOKIE}=`))?.slice(REVIEW_COOKIE.length + 1);
  if (!token || token.length > 1024) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts.every(p => /^[a-zA-Z0-9_-]+$/.test(p))) return null;
    const [payload, signature] = parts;
    if (!await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(payload))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (data.role !== 'reviewer' || data.aud !== new URL(request.url).origin || !Number.isFinite(data.exp) || data.exp <= nowMs || data.exp > nowMs + REVIEW_SESSION_SECONDS * 1000) return null;
    return { role: 'reviewer', expiresAt: data.exp };
  } catch {
    return null;
  }
}
export function reviewCookie(token = '') {
  return `${REVIEW_COOKIE}=${token}; Path=/; Max-Age=${token ? REVIEW_SESSION_SECONDS : 0}; HttpOnly; Secure; SameSite=Strict`;
}
export async function isAuthorizedReviewer(request, secret) {
  if (await isReviewerBearer(request, secret)) return true;
  return isSameOriginReviewRequest(request) && Boolean(await readReviewSession(request, secret));
}
