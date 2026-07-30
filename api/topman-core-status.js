import { jsonResponse } from './_json-response.js';
import { readTopmanCoreSnapshot } from './_topman-core.js';

export const config = { runtime: 'edge' };

const PUBLIC_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const TOPMAN_CORE_STATUS_CACHE_CONTROL =
  'max-age=30, stale-while-revalidate=30, stale-if-error=60';
export const TOPMAN_CORE_STATUS_CDN_CACHE_CONTROL =
  'public, s-maxage=60, stale-while-revalidate=30, stale-if-error=60';

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
  }
  if (request.method !== 'GET') {
    return jsonResponse({ status: 'METHOD_NOT_ALLOWED' }, 405, {
      ...PUBLIC_HEADERS,
      Allow: 'GET, OPTIONS',
      'Cache-Control': 'no-store',
    });
  }

  try {
    const snapshot = await readTopmanCoreSnapshot();
    return jsonResponse(snapshot, 200, {
      ...PUBLIC_HEADERS,
      'Cache-Control': TOPMAN_CORE_STATUS_CACHE_CONTROL,
      'CDN-Cache-Control': TOPMAN_CORE_STATUS_CDN_CACHE_CONTROL,
    });
  } catch {
    return jsonResponse({
      status: 'REDIS_DOWN',
      checkedAt: new Date().toISOString(),
    }, 503, {
      ...PUBLIC_HEADERS,
      'Cache-Control': 'no-store',
      'Retry-After': '5',
    });
  }
}
