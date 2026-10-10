import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import handler from '../api/topman-daily-brief.ts';
import { approveTopmanDailyBrief, briefRedisKey, buildTopmanDailyBrief } from '../shared/topman-daily-brief.js';
import { issueReviewSession, REVIEW_COOKIE } from '../api/_topman-review-session.js';

const envNames = ['TOPMAN_BRIEF_ADMIN_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_TO_ID'] as const;
const original = Object.fromEntries(envNames.map(k => [k, process.env[k]]));
const originalFetch = globalThis.fetch;
const store = new Map<string, string>();
const secret = 'synthetic-reviewer-test-credential';
const origin = 'https://preview.example.test';
const dateKey = '2026-10-10';
let deliveries = 0;
let failWrites = false;
let failSendPersistence = false;
let failDelivery = false;
let providerStatus = 200;
const draft = () => buildTopmanDailyBrief({ nowMs: Date.parse(`${dateKey}T01:00:00Z`), insights: { topStories: [{ primaryTitle: 'Synthetic weather exercise', primarySource: 'Synthetic source', category: 'disaster' }] } });
function post(action: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = { authorization: `Bearer ${secret}` }) {
 return new Request(`${origin}/api/topman-daily-brief`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ action, dateKey, ...extra }) });
}

beforeEach(() => {
 store.clear(); deliveries = 0; failWrites = false; failSendPersistence = false; failDelivery = false; providerStatus = 200;
 Object.assign(process.env, { TOPMAN_BRIEF_ADMIN_SECRET: secret, UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'synthetic-redis', LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-line', LINE_TO_ID: 'synthetic-recipient' });
 globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('https://redis.example.test/get/')) return Response.json({ result: store.get(decodeURIComponent(url.split('/get/')[1]!)) ?? null });
  if (url === 'https://redis.example.test/pipeline') {
   if (failWrites) return new Response('unavailable', { status: 503 });
   const commands = JSON.parse(String(init?.body)) as string[][];
   return Response.json(commands.map(([command, key, value, ...options]) => {
    if (command === 'SET') {
     if (failSendPersistence && key === briefRedisKey(dateKey) && value?.includes('"status":"sent"')) return { error: 'synthetic write failure' };
     if (options.includes('NX') && store.has(key!)) return { result: null };
     store.set(key!, value!); return { result: 'OK' };
    }
    if (command === 'DEL') return { result: store.delete(key!) ? 1 : 0 };
    throw new Error(`Unexpected fake command: ${command}`);
   }));
  }
  if (url === 'https://api.line.me/v2/bot/message/push') { deliveries++; if (failDelivery) throw new Error('synthetic network timeout'); return Response.json({}, { status: providerStatus }); }
  throw new Error(`External network forbidden in this test: ${url}`);
 };
});
after(() => { globalThis.fetch = originalFetch; for (const k of envNames) { if (original[k] === undefined) delete process.env[k]; else process.env[k] = original[k]; } });

describe('daily brief real handler with fake Redis and LINE', () => {
 it('requires approval again after edits and sends an approved revision once', async () => {
  assert.equal((await handler(post('save', { brief: draft() }))).status, 200);
  assert.equal((await handler(post('approve'))).status, 200);
  const edited = await handler(post('save', { lineMessage: 'Synthetic revised brief' }));
  assert.equal((await edited.json()).brief.status, 'draft');
  assert.equal((await handler(post('send'))).status, 409);
  assert.equal(deliveries, 0);
  assert.equal((await handler(post('approve'))).status, 200);
  assert.equal((await handler(post('send'))).status, 200);
  assert.equal((await handler(post('send'))).status, 409);
  assert.equal(deliveries, 1);
 });
 it('rejects forged client approval and content changed after server approval', async () => {
  const approved = approveTopmanDailyBrief(draft());
  assert.equal((await handler(post('send', { brief: approved }))).status, 409);
  store.set(briefRedisKey(dateKey), JSON.stringify(approved));
  const response = await handler(post('send', { lineMessage: 'unapproved change' }));
  assert.equal((await response.json()).error, 'APPROVAL_STALE');
  assert.equal(deliveries, 0);
 });
 it('claims a revision atomically across simultaneous sends', async () => {
  store.set(briefRedisKey(dateKey), JSON.stringify(approveTopmanDailyBrief(draft())));
  const results = await Promise.all([handler(post('send')), handler(post('send'))]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(deliveries, 1);
 });
 it('does not send when the claim store is unavailable', async () => {
  store.set(briefRedisKey(dateKey), JSON.stringify(approveTopmanDailyBrief(draft())));
  failWrites = true;
  assert.equal((await handler(post('send'))).status, 503);
  assert.equal(deliveries, 0);
 });
 it('retains the send claim when delivery succeeded but persistence failed', async () => {
  store.set(briefRedisKey(dateKey), JSON.stringify(approveTopmanDailyBrief(draft())));
  failSendPersistence = true;
  const response = await handler(post('send'));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'STATE_SAVE_FAILED');
  assert.equal((await handler(post('send'))).status, 409);
  assert.equal(deliveries, 1);
 });
 it('treats ambiguous delivery transport failure as locked, with an explicit recovery error', async () => {
  store.set(briefRedisKey(dateKey), JSON.stringify(approveTopmanDailyBrief(draft())));
  failDelivery = true;
  const response = await handler(post('send'));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'DELIVERY_UNCONFIRMED');
  assert.equal((await handler(post('send'))).status, 409);
  assert.equal(deliveries, 1);
 });
 it('keeps an ambiguous provider 5xx locked but permits retry after a definite 4xx rejection', async () => {
  store.set(briefRedisKey(dateKey), JSON.stringify(approveTopmanDailyBrief(draft())));
  providerStatus = 400;
  assert.equal((await handler(post('send'))).status, 502);
  providerStatus = 500;
  assert.equal((await (await handler(post('send'))).json()).error, 'DELIVERY_UNCONFIRMED');
  assert.equal((await handler(post('send'))).status, 409);
  assert.equal(deliveries, 2);
 });
 it('accepts same-origin reviewer cookies, rejects cross-origin reuse, and never caches state', async () => {
  const session = await issueReviewSession(post('save'), secret);
  const cookie = `${REVIEW_COOKIE}=${session.token}`;
  const accepted = await handler(post('save', { brief: draft() }, { cookie, origin }));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('cache-control'), 'private, no-store');
  assert.equal((await handler(post('save', {}, { cookie, origin: 'https://attacker.example.test' }))).status, 401);
  const status = await handler(new Request(`${origin}/api/topman-daily-brief?session=1`, { headers: { cookie } }));
  assert.equal((await status.json()).authenticated, true);
 });
 it('bounds unauthenticated JSON input before login and rejects null payloads', async () => {
  assert.equal((await handler(post('login', { oversized: 'x'.repeat(70_000) }, {}))).status, 413);
  const request = new Request(`${origin}/api/topman-daily-brief`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' });
  assert.equal((await handler(request)).status, 400);
 });
 it('fails closed when the login limiter has no configuration and rejects foreign origins', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.equal((await handler(post('login', {}, { origin, authorization: `Bearer ${secret}` }))).status, 503);
  assert.equal((await handler(post('login', {}, { origin: 'https://attacker.example.test', authorization: `Bearer ${secret}` }))).status, 403);
 });
});
