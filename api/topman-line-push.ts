// Thin POST wrapper — primary send path is action=send on /api/topman-daily-brief.
// Kept for direct testing of LINE credentials.

// @ts-expect-error -- shared JSON helper
import { jsonResponse } from './_json-response.js';
// @ts-expect-error -- LINE helper
import { isLineConfigured, pushLineTextMessage } from './_topman-line-push.js';

export const config = { runtime: 'edge' };

function isAuthorized(request: Request): boolean {
  const secret = process.env.TOPMAN_BRIEF_ADMIN_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    return jsonResponse({
      ok: true,
      lineConfigured: isLineConfigured(),
      note: 'POST { text } with Bearer TOPMAN_BRIEF_ADMIN_SECRET หรือ CRON_SECRET เพื่อทดสอบส่ง',
    }, 200);
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  if (!isAuthorized(request)) {
    return jsonResponse({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  let payload: { text?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'INVALID_JSON' }, 400);
  }

  const result = await pushLineTextMessage(String(payload.text || ''));
  return jsonResponse(result, result.ok ? 200 : (result.error === 'LINE_NOT_CONFIGURED' ? 503 : 502));
}
