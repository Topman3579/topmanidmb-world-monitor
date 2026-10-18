#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

// This fork must never probe the upstream project. There is no public health
// endpoint to fall back to: production sits behind Vercel Deployment Protection.
// Set the HEALTH_URL repo variable to this deployment's /api/health?compact=1
// (run with WM_HEALTH_SCOPE=fork; see api/health.js).
const UPSTREAM_HOST = 'worldmonitor.app';
export const VERCEL_PROTECTION_BYPASS_HEADER = 'x-vercel-protection-bypass';

const DISABLED_NOTICE = [
  '::notice::Seed freshness monitor is disabled until HEALTH_URL is configured.',
  'Set the repo variable HEALTH_URL to this fork\'s /api/health?compact=1 and run that endpoint with WM_HEALTH_SCOPE=fork (see api/health.js).',
  'This monitor does not default to the upstream health endpoint.',
].join(' ');

export function validateCompactHealthPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Compact health payload must be an object');
  }
  // Compact health omits `problems` entirely when every check is healthy.
  if (payload.problems == null && payload.status === 'HEALTHY') return payload;
  if (!payload.problems || typeof payload.problems !== 'object' || Array.isArray(payload.problems)) {
    throw new Error('Compact health payload must contain a problems object');
  }
  return payload;
}

// api/health.js emits scope: 'fork' only when WM_HEALTH_SCOPE=fork, i.e. when
// this fork's owned seed checks were actually evaluated. Any other HEALTHY
// payload (unscoped deployment, foreign endpoint) proves nothing about them.
export function assertForkHealthScope(payload) {
  if (payload?.scope !== 'fork') {
    throw new Error(
      `Compact health payload is not fork-scoped (scope=${JSON.stringify(payload?.scope ?? null)}). Serve HEALTH_URL with WM_HEALTH_SCOPE=fork so this fork's seed checks are evaluated.`,
    );
  }
  return payload;
}

export function findStaleSeedProblems(payload) {
  validateCompactHealthPayload(payload);
  return Object.entries(payload.problems ?? {})
    .filter(([, problem]) => problem?.status === 'STALE_SEED')
    .map(([name, problem]) => ({
      name,
      seedAgeMin: problem.seedAgeMin,
      maxStaleMin: problem.maxStaleMin,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isUpstreamWorldMonitorHost(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/\.+$/, '');
  return host === UPSTREAM_HOST || host.endsWith(`.${UPSTREAM_HOST}`);
}

// Pure decision for HEALTH_URL. `skip` is a successful no-op (exit 0).
// `reject` is a config error (exit 1). `fetch` is the only path that hits the network.
// `requireHttps` is set whenever the Vercel protection bypass secret will be
// attached, so the credential can never travel over plain HTTP.
export function planSeedFreshnessCheck(healthUrl, { requireHttps = false } = {}) {
  const trimmed = String(healthUrl ?? '').trim();
  if (!trimmed) {
    return { action: 'skip', notice: DISABLED_NOTICE };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { action: 'reject', error: 'HEALTH_URL is not a valid absolute URL.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { action: 'reject', error: `HEALTH_URL scheme ${url.protocol} is not allowed.` };
  }

  if (requireHttps && url.protocol !== 'https:') {
    return {
      action: 'reject',
      error: 'HEALTH_URL must use https:// when VERCEL_AUTOMATION_BYPASS_SECRET is configured.',
    };
  }

  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (isUpstreamWorldMonitorHost(host)) {
    return {
      action: 'reject',
      error: `Refusing HEALTH_URL host ${host}: worldmonitor.app and its subdomains are the upstream project and must not be checked.`,
    };
  }

  return { action: 'fetch', url: url.toString() };
}

// Adds the Vercel protection bypass header only when a secret is present.
// Callers must not log the returned header value.
export function healthRequestHeaders(bypassSecret) {
  const headers = { 'User-Agent': 'worldmonitor-seed-freshness-monitor/1.0' };
  const secret = typeof bypassSecret === 'string' ? bypassSecret.trim() : '';
  if (secret) headers[VERCEL_PROTECTION_BYPASS_HEADER] = secret;
  return headers;
}

export function hasBypassHeader(headers) {
  return Boolean(headers?.[VERCEL_PROTECTION_BYPASS_HEADER]);
}

// Fetches the planned HEALTH_URL. When the bypass header is attached, redirects
// are never followed: Node's fetch keeps custom headers across cross-origin
// redirects, which would hand the secret to whatever host the redirect names.
export async function fetchHealth(url, headers, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const withSecret = hasBypassHeader(headers);
  const response = await fetchImpl(url, {
    headers,
    redirect: withSecret ? 'manual' : 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (withSecret && (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400))) {
    throw new Error(
      `Compact health request answered a redirect (HTTP ${response.status || 'opaque'}); refusing to follow it while the protection bypass secret is attached. Point HEALTH_URL at the final https URL.`,
    );
  }
  return response;
}

async function main() {
  const automationBypass = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '').trim();
  const plan = planSeedFreshnessCheck(process.env.HEALTH_URL, { requireHttps: Boolean(automationBypass) });
  if (plan.action === 'skip') {
    console.log(plan.notice);
    return;
  }
  if (plan.action === 'reject') {
    console.error(plan.error);
    process.exitCode = 1;
    return;
  }

  // Never print VERCEL_AUTOMATION_BYPASS_SECRET or the bypass header value.
  const headers = healthRequestHeaders(automationBypass);
  const response = await fetchHealth(plan.url, headers);
  if (!response.ok) {
    throw new Error(`Compact health request failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  assertForkHealthScope(payload);
  const staleSeeds = findStaleSeedProblems(payload);
  if (staleSeeds.length === 0) {
    console.log(`Seed freshness healthy at ${payload.checkedAt || 'unknown time'}: no STALE_SEED problems.`);
    return;
  }

  console.error(`Seed freshness alert: ${staleSeeds.length} seed(s) exceeded maxStaleMin.`);
  for (const seed of staleSeeds) {
    console.error(`- ${seed.name}: age=${seed.seedAgeMin}m max=${seed.maxStaleMin}m`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
