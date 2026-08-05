/**
 * LINE Messaging API push helper for TOPMAN daily briefs.
 * Env-gated: LINE_CHANNEL_ACCESS_TOKEN + LINE_TO_ID required.
 */

export function isLineConfigured(
  env = process.env,
) {
  return Boolean(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_TO_ID);
}

/**
 * @param {string} text
 * @param {{
 *   token?: string,
 *   to?: string,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export async function pushLineTextMessage(text, options = {}) {
  const token = options.token ?? process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = options.to ?? process.env.LINE_TO_ID;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!token || !to) {
    return {
      ok: false,
      configured: false,
      error: 'LINE_NOT_CONFIGURED',
      detail: 'ต้องตั้ง LINE_CHANNEL_ACCESS_TOKEN และ LINE_TO_ID บน Vercel',
    };
  }

  const bodyText = String(text || '').slice(0, 4500);
  if (!bodyText.trim()) {
    return { ok: false, configured: true, error: 'EMPTY_MESSAGE' };
  }

  const resp = await fetchImpl('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: bodyText }],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    return {
      ok: false,
      configured: true,
      error: 'LINE_API_ERROR',
      status: resp.status,
      detail: detail.slice(0, 400),
    };
  }

  return { ok: true, configured: true };
}
