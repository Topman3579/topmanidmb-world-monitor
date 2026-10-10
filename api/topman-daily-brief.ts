// TOPMAN daily executive brief — GET public read, POST mutate (reviewer session),
// GET ?generate=1 with CRON_SECRET for 07:30 Asia/Bangkok draft creation.

// @ts-expect-error -- shared JSON helper
import { jsonResponse as baseJsonResponse } from './_json-response.js';
// @ts-expect-error -- shared reviewer session helper
import { isAuthorizedReviewer, isReviewerBearer, isSameOriginReviewRequest, issueReviewSession, readReviewSession, reviewCookie } from './_topman-review-session.js';
// @ts-expect-error -- shared rate limiter
import { checkRateLimit } from './_rate-limit.js';

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return baseJsonResponse(body, status, { 'Cache-Control': 'private, no-store', ...headers });
}
// @ts-expect-error -- Upstash helpers
import { readJsonFromUpstash, redisPipeline } from './_upstash-json.js';
// @ts-expect-error -- LINE helper
import { isLineConfigured, pushLineTextMessage } from './_topman-line-push.js';
// @ts-expect-error -- Core 6 snapshot for empty-insight fallbacks
import { loadTopmanCoreForBrief } from './_topman-core.js';
import {
  approveTopmanDailyBrief,
  bangkokDateKey,
  briefRedisKey,
  buildTopmanDailyBrief,
  isTopmanDailyBrief,
  isTopmanDailyBriefApprovable,
  markTopmanDailyBriefSent,
  patchTopmanDailyBrief,
} from '../shared/topman-daily-brief.js';

export const config = { runtime: 'edge' };

const BRIEF_TTL_SECONDS = 7 * 24 * 60 * 60;

function adminSecret(): string | undefined {
  return process.env.TOPMAN_BRIEF_ADMIN_SECRET;
}

async function isAuthorizedAdmin(request: Request): Promise<boolean> {
  return isAuthorizedReviewer(request, adminSecret());
}

function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.method !== 'GET') return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

async function readBriefPayload(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_JSON');
  const limit = 64 * 1024;
  let size = 0;
  const chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error('BODY_TIMEOUT')); }, 5_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new Error('BODY_TOO_LARGE'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { clearTimeout(timer); }
}

async function loadBrief(dateKey: string): Promise<Record<string, unknown> | null> {
  try {
    const value = await readJsonFromUpstash(briefRedisKey(dateKey));
    return isTopmanDailyBrief(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function saveBrief(brief: Record<string, unknown>): Promise<boolean> {
  const key = briefRedisKey(String(brief.dateKey));
  const payload = JSON.stringify(brief);
  const result = await redisPipeline([
    ['SET', key, payload, 'EX', String(BRIEF_TTL_SECONDS)],
  ]);
  return Array.isArray(result) && result[0]?.result === 'OK' && !result[0]?.error;
}

function sendClaimKey(brief: Record<string, unknown>): string {
  const dateKey = String(brief.dateKey || 'unknown');
  const revision = String(brief.approvedAt || 'unapproved');
  return `topman:daily-brief-send:${dateKey}:${revision}`;
}

async function claimBriefSend(brief: Record<string, unknown>): Promise<'claimed' | 'duplicate' | 'unavailable'> {
  const result = await redisPipeline([
    ['SET', sendClaimKey(brief), 'processing', 'NX', 'EX', String(BRIEF_TTL_SECONDS)],
  ]);
  if (!result || result[0]?.error) return 'unavailable';
  return result[0]?.result === 'OK' ? 'claimed' : 'duplicate';
}

async function releaseBriefSendClaim(brief: Record<string, unknown>): Promise<void> {
  await redisPipeline([['DEL', sendClaimKey(brief)]]);
}

async function loadInsights(): Promise<unknown> {
  try {
    return await readJsonFromUpstash('news:insights:v1');
  } catch {
    return null;
  }
}

function publicPayload(brief: Record<string, unknown> | null, dateKey: string) {
  return {
    ok: true,
    dateKey,
    brief,
    lineConfigured: isLineConfigured(),
  };
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const dateKey = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dateParam
    : bangkokDateKey();

  if (request.method === 'GET') {
    if (url.searchParams.get('session') === '1') {
      const session = await readReviewSession(request, adminSecret());
      return jsonResponse({ ok: true, authenticated: Boolean(session), expiresAt: session?.expiresAt ?? null }, 200);
    }
    const wantsGenerate = url.searchParams.get('generate') === '1';
    if (wantsGenerate) {
      if (!isAuthorizedCron(request) && !await isAuthorizedAdmin(request)) {
        return jsonResponse({ ok: false, error: 'UNAUTHORIZED' }, 401);
      }
      const existing = await loadBrief(dateKey);
      if (existing && (existing.status === 'approved' || existing.status === 'sent')) {
        return jsonResponse({
          ...publicPayload(existing, dateKey),
          generated: false,
          reason: 'already_locked',
        }, 200);
      }
      const [insights, core] = await Promise.all([loadInsights(), loadTopmanCoreForBrief()]);
      const brief = buildTopmanDailyBrief({
        insights,
        core,
        existing,
        nowMs: Date.now(),
      });
      const saved = await saveBrief(brief);
      return jsonResponse({
        ...publicPayload(brief, dateKey),
        generated: true,
        saved,
      }, 200);
    }

    const brief = await loadBrief(dateKey);
    return jsonResponse(publicPayload(brief, dateKey), 200);
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }


  let payload: {
    action?: string;
    dateKey?: string;
    lineMessage?: string;
    memoMarkdown?: string;
    brief?: Record<string, unknown>;
  } = {};
  try {
    payload = await readBriefPayload(request) as typeof payload;
  } catch (error) {
    const code = error instanceof Error && ['BODY_TOO_LARGE', 'BODY_TIMEOUT'].includes(error.message) ? error.message : 'INVALID_JSON';
    return jsonResponse({ ok: false, error: code }, code === 'BODY_TOO_LARGE' ? 413 : code === 'BODY_TIMEOUT' ? 408 : 400);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return jsonResponse({ ok: false, error: 'INVALID_JSON' }, 400);
  const action = payload.action || 'save';
  if (action === 'login' || action === 'logout') {
    if (!isSameOriginReviewRequest(request)) return jsonResponse({ ok: false, error: 'ORIGIN_REJECTED' }, 403);
    if (action === 'logout') return jsonResponse({ ok: true, authenticated: false }, 200, { 'Set-Cookie': reviewCookie() });
    const limited = await checkRateLimit(request, { 'Cache-Control': 'private, no-store' }, { scope: 'topman-review-login', limit: 5, window: '60 s', failClosed: true });
    if (limited) return limited;
    if (!await isReviewerBearer(request, adminSecret())) return jsonResponse({ ok: false, error: 'UNAUTHORIZED' }, 401);
    const session = await issueReviewSession(request, adminSecret());
    return jsonResponse({ ok: true, authenticated: true, expiresAt: session.expiresAt }, 200, { 'Set-Cookie': reviewCookie(session.token) });
  }
  if (!await isAuthorizedAdmin(request)) {
    return jsonResponse({ ok: false, error: 'UNAUTHORIZED', lineConfigured: isLineConfigured(), dateKey }, 401);
  }
  const targetDate = payload.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(payload.dateKey)
    ? payload.dateKey
    : dateKey;

  if (action === 'regenerate') {
    const existing = await loadBrief(targetDate);
    if (existing && (existing.status === 'approved' || existing.status === 'sent')) {
      return jsonResponse({
        ...publicPayload(existing, targetDate),
        ok: false,
        error: 'LOCKED',
        detail: 'บรีฟที่อนุมัติหรือส่งแล้วจะไม่ถูกสร้างใหม่',
      }, 409);
    }
    const [insights, core] = await Promise.all([loadInsights(), loadTopmanCoreForBrief()]);
    let toSave = buildTopmanDailyBrief({
      insights,
      core,
      existing,
      nowMs: Date.now(),
    });
    if (isTopmanDailyBrief(payload.brief)) {
      toSave = {
        ...toSave,
        ...payload.brief,
        dateKey: targetDate,
        status: 'draft',
        approvedAt: null,
        sentAt: null,
        updatedAt: new Date().toISOString(),
        lineMessage: typeof payload.brief.lineMessage === 'string'
          ? payload.brief.lineMessage
          : toSave.lineMessage,
        memoMarkdown: typeof payload.brief.memoMarkdown === 'string'
          ? payload.brief.memoMarkdown
          : toSave.memoMarkdown,
      };
    }
    const saved = await saveBrief(toSave);
    if (!saved) {
      return jsonResponse({
        ...publicPayload(toSave, targetDate),
        ok: false,
        error: 'STATE_SAVE_FAILED',
        detail: 'สร้างร่างแล้ว แต่บันทึกสถานะไม่สำเร็จ',
      }, 503);
    }
    return jsonResponse(publicPayload(toSave, targetDate), 200);
  }

  const storedBrief = await loadBrief(targetDate);
  let brief = storedBrief;
  if (!brief && isTopmanDailyBrief(payload.brief)) {
    brief = payload.brief as Record<string, unknown>;
  }
  if (!brief) {
    const [insights, core] = await Promise.all([loadInsights(), loadTopmanCoreForBrief()]);
    brief = buildTopmanDailyBrief({ insights, core, nowMs: Date.now() });
  }
  // Requests may target a historical day. Never allow a client-supplied or
  // freshly generated current-day dateKey to select a different Redis key.
  brief = { ...brief, dateKey: targetDate };

  if (action === 'save') {
    brief = patchTopmanDailyBrief(brief, {
      lineMessage: payload.lineMessage,
      memoMarkdown: payload.memoMarkdown,
    });
    const saved = await saveBrief(brief);
    if (!saved) {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'STATE_SAVE_FAILED',
        detail: 'แก้ไขร่างแล้ว แต่บันทึกสถานะไม่สำเร็จ',
      }, 503);
    }
    return jsonResponse(publicPayload(brief, targetDate), 200);
  }

  if (action === 'approve') {
    brief = patchTopmanDailyBrief(brief, {
      lineMessage: payload.lineMessage,
      memoMarkdown: payload.memoMarkdown,
    });
    if (!isTopmanDailyBriefApprovable(brief)) {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'INSUFFICIENT_EVIDENCE',
        detail: 'ยังไม่มีข้อเท็จจริง แหล่งอ้างอิง และที่มาข้อมูลเพียงพอสำหรับอนุมัติ',
      }, 409);
    }
    brief = approveTopmanDailyBrief(brief);
    const saved = await saveBrief(brief);
    if (!saved) {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'STATE_SAVE_FAILED',
        detail: 'อนุมัติแล้ว แต่บันทึกสถานะไม่สำเร็จ จึงยังส่ง LINE ไม่ได้',
      }, 503);
    }
    return jsonResponse(publicPayload(brief, targetDate), 200);
  }

  if (action === 'send') {
    // Delivery must only use the server-side revision that was persisted and
    // approved. A client-provided "approved" object is never sufficient.
    if (!storedBrief) {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'NOT_APPROVED',
        detail: 'ไม่พบฉบับที่บันทึกและอนุมัติบนเซิร์ฟเวอร์',
      }, 409);
    }
    if (brief.status === 'sent') {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'ALREADY_SENT',
        detail: 'บรีฟนี้ส่ง LINE OA แล้ว หากต้องส่งซ้ำให้สร้างร่างและอนุมัติใหม่',
      }, 409);
    }
    if (brief.status !== 'approved') {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'NOT_APPROVED',
        detail: 'ต้องกดอนุมัติก่อนส่ง LINE OA',
      }, 409);
    }
    if (
      (typeof payload.lineMessage === 'string' && payload.lineMessage !== brief.lineMessage)
      || (typeof payload.memoMarkdown === 'string' && payload.memoMarkdown !== brief.memoMarkdown)
    ) {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'APPROVAL_STALE',
        detail: 'ข้อความเปลี่ยนหลังอนุมัติ ต้องบันทึกและอนุมัติใหม่ก่อนส่ง',
      }, 409);
    }
    const sendClaim = await claimBriefSend(brief);
    if (sendClaim === 'unavailable') {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'SEND_GUARD_UNAVAILABLE',
        detail: 'ระบบป้องกันการส่งซ้ำไม่พร้อม จึงยังไม่ส่ง LINE',
      }, 503);
    }
    if (sendClaim === 'duplicate') {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'SEND_IN_PROGRESS',
        detail: 'บรีฟฉบับที่อนุมัตินี้กำลังส่งหรือส่งแล้ว ระบบป้องกันการส่งซ้ำ',
      }, 409);
    }
    let push;
    try {
      push = await pushLineTextMessage(String(brief.lineMessage || ''));
    } catch {
      // The provider may already have accepted the request. Keep the claim;
      // retrying an ambiguous delivery could send the same revision twice.
      return jsonResponse({ ...publicPayload(brief, targetDate), ok: false, error: 'DELIVERY_UNCONFIRMED', detail: 'ยังยืนยันผลส่งไม่ได้ ระบบล็อกฉบับนี้ไว้ ให้ตรวจผลรับก่อนดำเนินการต่อ' }, 502);
    }
    if (!push.ok) {
      if ((push.status ?? 0) >= 500) {
        return jsonResponse({ ...publicPayload(brief, targetDate), ok: false, error: 'DELIVERY_UNCONFIRMED', detail: 'ผู้ให้บริการยังยืนยันผลส่งไม่ได้ ระบบล็อกฉบับนี้ไว้ ให้ตรวจผลรับก่อนดำเนินการต่อ' }, 502);
      }
      await releaseBriefSendClaim(brief);
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: push.error,
        detail: push.detail,
      }, push.error === 'LINE_NOT_CONFIGURED' ? 503 : 502);
    }
    brief = markTopmanDailyBriefSent(brief);
    const saved = await saveBrief(brief);
    if (!saved) {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'STATE_SAVE_FAILED',
        detail: 'LINE ถูกส่งแล้ว แต่บันทึกสถานะไม่สำเร็จ ระบบยังล็อกไว้เพื่อป้องกันการส่งซ้ำ',
      }, 502);
    }
    return jsonResponse({ ...publicPayload(brief, targetDate), sent: true }, 200);
  }

  return jsonResponse({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
}
