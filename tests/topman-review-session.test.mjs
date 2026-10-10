import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAuthorizedReviewer, isReviewerBearer, issueReviewSession, readReviewSession, REVIEW_COOKIE, REVIEW_SESSION_SECONDS, reviewCookie } from '../api/_topman-review-session.js';

const secret = 'synthetic-reviewer-test-credential';
const origin = 'https://preview.example.test';
const now = 1_800_000_000_000;
function request(headers = {}) { return new Request(`${origin}/api/topman-daily-brief`, { method: 'POST', headers }); }

describe('reviewer session boundaries', () => {
  it('issues a reviewer-only HttpOnly host cookie and accepts it before expiry', async () => {
    const issued = await issueReviewSession(request(), secret, now);
    assert.equal(issued.expiresAt, now + REVIEW_SESSION_SECONDS * 1000);
    assert.doesNotMatch(issued.token, /synthetic-reviewer/);
    const cookie = reviewCookie(issued.token);
    assert.match(cookie, /__Host-topman-review=/);
    assert.match(cookie, /Path=\/; Max-Age=900; HttpOnly; Secure; SameSite=Strict$/);
    assert.equal((await readReviewSession(request({ cookie }), secret, now + 1)).role, 'reviewer');
  });
  it('rejects expired, tampered, malformed, and rotated-credential sessions', async () => {
    const issued = await issueReviewSession(request(), secret, now);
    const cookie = `${REVIEW_COOKIE}=${issued.token}`;
    assert.equal(await readReviewSession(request({ cookie }), secret, issued.expiresAt), null);
    assert.equal(await readReviewSession(request({ cookie }), 'new-credential', now), null);
    assert.equal(await readReviewSession(request({ cookie: `${REVIEW_COOKIE}=bad.payload` }), secret, now), null);
    assert.equal(await readReviewSession(request({ cookie: `${cookie}extra` }), secret, now), null);
    assert.equal(await readReviewSession(request({ cookie }), '', now), null);
  });
  it('cannot replay a token on a different host', async () => {
    const issued = await issueReviewSession(request(), secret, now);
    const other = new Request('https://other.example.test/api/topman-daily-brief', { headers: { cookie: `${REVIEW_COOKIE}=${issued.token}` } });
    assert.equal(await readReviewSession(other, secret, now), null);
  });
  it('requires same-origin for cookie-authorized mutations', async () => {
    const issued = await issueReviewSession(request(), secret);
    const cookie = `${REVIEW_COOKIE}=${issued.token}`;
    assert.equal(await isAuthorizedReviewer(request({ cookie, origin }), secret), true);
    assert.equal(await isAuthorizedReviewer(request({ cookie }), secret), false);
    assert.equal(await isAuthorizedReviewer(request({ cookie, origin: 'https://attacker.example.test' }), secret), false);
    assert.equal(await isAuthorizedReviewer(request({ cookie, origin, 'sec-fetch-site': 'cross-site' }), secret), false);
  });
  it('keeps explicit reviewer bearer automation separate from anonymous or cron credentials', async () => {
    assert.equal(await isReviewerBearer(request({ authorization: `Bearer ${secret}` }), secret), true);
    assert.equal(await isReviewerBearer(request({ authorization: secret }), secret), false);
    assert.equal(await isAuthorizedReviewer(request({ authorization: 'Bearer synthetic-cron' }), secret), false);
    assert.equal(await isAuthorizedReviewer(request({ cookie: 'wm-session=anonymous' }), secret), false);
  });
  it('clears the browser cookie on sign out', () => {
    assert.match(reviewCookie(), /Max-Age=0; HttpOnly; Secure; SameSite=Strict$/);
  });
});
