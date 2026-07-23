/**
 * Shared helpers for the host-derived agent-readiness discovery documents.
 *
 * This module is JavaScript because Vercel's Edge Function validator rejects
 * direct TypeScript module references from middleware output.
 */

// Apex + exactly one DNS label (www, api, tech, finance, …). Rejects hosts
// carrying a port or an unrecognized suffix.
const ALLOWED_HOST = /^(?:[a-z0-9-]+\.)?worldmonitor\.app$/;
const FALLBACK_ORIGIN = 'https://worldmonitor.app';

/**
 * @param {Request} req
 * @returns {string}
 */
export function resolveMetadataOrigin(req) {
  const url = new URL(req.url);
  const host = (req.headers.get('host') ?? url.host).toLowerCase();
  return ALLOWED_HOST.test(host) ? `https://${host}` : FALLBACK_ORIGIN;
}

/**
 * These documents are read-only. Answer CORS preflights, allow GET/HEAD, and
 * reject everything else with a spec-correct 405 + Allow.
 *
 * @param {Request} req
 * @returns {Response | null}
 */
export function guardMetadataMethod(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' },
    });
  }
  return new Response(null, { status: 405, headers: { ...cors, Allow: 'GET, HEAD, OPTIONS' } });
}
