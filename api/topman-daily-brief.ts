// TOPMAN daily executive brief — GET public read, POST mutate (admin secret),
// GET ?generate=1 with CRON_SECRET for 07:30 Asia/Bangkok draft creation.

// @ts-expect-error -- shared JSON helper
import { jsonResponse } from './_json-response.js';
// @ts-expect-error -- Upstash helpers
import { readJsonFromUpstash, redisPipeline } from './_upstash-json.js';
// @ts-expect-error -- LINE helper
import { isLineConfigured, pushLineTextMessage } from './_topman-line-push.js';
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

function isAuthorizedAdmin(request: Request): boolean {
  const secret = adminSecret();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.method !== 'GET') return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
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
  return Array.isArray(result);
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
    const wantsGenerate = url.searchParams.get('generate') === '1';
    if (wantsGenerate) {
      if (!isAuthorizedCron(request) && !isAuthorizedAdmin(request)) {
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
      const insights = await loadInsights();
      const brief = buildTopmanDailyBrief({
        insights,
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

  if (!isAuthorizedAdmin(request)) {
    return jsonResponse({
      ok: false,
      error: 'UNAUTHORIZED',
      detail: 'ต้องใช้ Bearer TOPMAN_BRIEF_ADMIN_SECRET',
      lineConfigured: isLineConfigured(),
      dateKey,
    }, 401);
  }

  let payload: {
    action?: string;
    dateKey?: string;
    lineMessage?: string;
    memoMarkdown?: string;
    brief?: Record<string, unknown>;
  } = {};
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'INVALID_JSON' }, 400);
  }

  const action = payload.action || 'save';
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
    const insights = await loadInsights();
    let toSave = buildTopmanDailyBrief({
      insights,
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
    const insights = await loadInsights();
    brief = buildTopmanDailyBrief({ insights, nowMs: Date.now() });
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
    const push = await pushLineTextMessage(String(brief.lineMessage || ''));
    if (!push.ok) {
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
