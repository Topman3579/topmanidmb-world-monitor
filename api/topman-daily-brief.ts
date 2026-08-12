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
  markTopmanDailyBriefSent,
  patchTopmanDailyBrief,
} from '../shared/topman-daily-brief.js';

export const config = { runtime: 'edge' };

const BRIEF_TTL_SECONDS = 7 * 24 * 60 * 60;

function adminSecret(): string | undefined {
  return process.env.TOPMAN_BRIEF_ADMIN_SECRET || process.env.CRON_SECRET;
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
      detail: 'ต้องใช้ Bearer TOPMAN_BRIEF_ADMIN_SECRET หรือ CRON_SECRET',
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
    await saveBrief(toSave);
    return jsonResponse(publicPayload(toSave, targetDate), 200);
  }

  let brief = await loadBrief(targetDate);
  if (!brief && isTopmanDailyBrief(payload.brief)) {
    brief = payload.brief as Record<string, unknown>;
  }
  if (!brief) {
    const insights = await loadInsights();
    brief = buildTopmanDailyBrief({ insights, nowMs: Date.now() });
  }

  if (action === 'save') {
    brief = patchTopmanDailyBrief(brief, {
      lineMessage: payload.lineMessage,
      memoMarkdown: payload.memoMarkdown,
    });
    await saveBrief(brief);
    return jsonResponse(publicPayload(brief, targetDate), 200);
  }

  if (action === 'approve') {
    brief = patchTopmanDailyBrief(brief, {
      lineMessage: payload.lineMessage,
      memoMarkdown: payload.memoMarkdown,
    });
    brief = approveTopmanDailyBrief(brief);
    await saveBrief(brief);
    return jsonResponse(publicPayload(brief, targetDate), 200);
  }

  if (action === 'send') {
    if (brief.status !== 'approved' && brief.status !== 'sent') {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: 'NOT_APPROVED',
        detail: 'ต้องกดอนุมัติก่อนส่ง LINE OA',
      }, 409);
    }
    brief = patchTopmanDailyBrief(brief, {
      lineMessage: payload.lineMessage,
      memoMarkdown: payload.memoMarkdown,
    });
    const push = await pushLineTextMessage(String(brief.lineMessage || ''));
    if (!push.ok) {
      return jsonResponse({
        ...publicPayload(brief, targetDate),
        ok: false,
        error: push.error,
        detail: push.detail,
      }, push.error === 'LINE_NOT_CONFIGURED' ? 503 : 502);
    }
    brief = markTopmanDailyBriefSent(brief);
    await saveBrief(brief);
    return jsonResponse({ ...publicPayload(brief, targetDate), sent: true }, 200);
  }

  return jsonResponse({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
}
