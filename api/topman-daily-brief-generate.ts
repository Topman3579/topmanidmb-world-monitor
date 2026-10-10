// Vercel Cron: 07:30 Asia/Bangkok (00:30 UTC) — create draft only, never auto-send.

// @ts-expect-error -- shared JSON helper
import { jsonResponse } from './_json-response.js';
// @ts-expect-error -- Upstash helpers
import { readJsonFromUpstash, redisPipeline } from './_upstash-json.js';
// @ts-expect-error -- Core 6 snapshot for empty-insight fallbacks
import { loadTopmanCoreForBrief } from './_topman-core.js';
import {
  bangkokDateKey,
  briefRedisKey,
  buildTopmanDailyBrief,
  isTopmanDailyBrief,
} from '../shared/topman-daily-brief.js';

export const config = { runtime: 'edge' };

const BRIEF_TTL_SECONDS = 7 * 24 * 60 * 60;

function isAuthorizedCronRequest(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret || request.method !== 'GET') return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export default async function handler(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return jsonResponse({ ok: false, error: 'CRON_SECRET_MISSING' }, 503);
  }
  if (!isAuthorizedCronRequest(request)) {
    return jsonResponse({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  const dateKey = bangkokDateKey();
  let existing: Record<string, unknown> | null = null;
  try {
    const value = await readJsonFromUpstash(briefRedisKey(dateKey));
    if (isTopmanDailyBrief(value)) existing = value as Record<string, unknown>;
  } catch {
    existing = null;
  }

  if (existing && (existing.status === 'approved' || existing.status === 'sent')) {
    return jsonResponse({
      ok: true,
      generated: false,
      reason: 'already_locked',
      dateKey,
      status: existing.status,
    }, 200);
  }

  let insights: unknown = null;
  try {
    insights = await readJsonFromUpstash('news:insights:v1');
  } catch {
    insights = null;
  }
  const core = await loadTopmanCoreForBrief();

  const brief = buildTopmanDailyBrief({
    insights,
    core,
    existing,
    nowMs: Date.now(),
  });

  const saved = await redisPipeline([
    ['SET', briefRedisKey(dateKey), JSON.stringify(brief), 'EX', String(BRIEF_TTL_SECONDS)],
  ]);

  return jsonResponse({
    ok: true,
    generated: true,
    saved: Array.isArray(saved),
    dateKey,
    status: brief.status,
    sources: brief.sources,
    generatedFrom: brief.generatedFrom,
  }, 200);
}
