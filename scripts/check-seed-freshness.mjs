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
export function planSeedFreshnessCheck(healthUrl) {
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

async function main() {
  const plan = planSeedFreshnessCheck(process.env.HEALTH_URL);
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
  const headers = healthRequestHeaders(process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const response = await fetch(plan.url, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Compact health request failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
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
