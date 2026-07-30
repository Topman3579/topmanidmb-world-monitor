import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

type TopmanHealthModule = typeof import('../src/services/topman-health-status.ts');

async function loadTopmanHealthModule(): Promise<TopmanHealthModule> {
  const tempDir = mkdtempSync(join(tmpdir(), 'wm-topman-health-'));
  const outfile = join(tempDir, 'topman-health.bundle.mjs');

  const result = await build({
    entryPoints: [resolve(process.cwd(), 'src/services/topman-health-status.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    plugins: [{
      name: 'topman-health-i18n-stub',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@\/services\/i18n$/ }, () => ({
          path: 'i18n-stub',
          namespace: 'topman-health-stub',
        }));
        buildApi.onLoad({ filter: /.*/, namespace: 'topman-health-stub' }, () => ({
          contents: 'export function getTopmanLanguageMode() { return "bilingual"; }',
          loader: 'js',
        }));
      },
    }],
  });

  const bundledSource = result.outputFiles[0]?.text;
  if (!bundledSource) throw new Error('TOPMAN health test bundle was not created');
  writeFileSync(outfile, bundledSource, 'utf8');

  try {
    return await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`) as TopmanHealthModule;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const {
  buildTopmanHealthPresentation,
  classifyTopmanHealthPayload,
  fetchTopmanHealthSnapshot,
  formatTopmanHealthLabel,
  getTopmanSourceHref,
  TOPMAN_HEALTH_POLL_INTERVAL_MS,
} = await loadTopmanHealthModule();

const NOW_MS = Date.parse('2026-07-30T00:00:00.000Z');

function healthPayload(overrides: {
  status?: string;
  checkedAt?: string;
  total?: number;
  ok?: number;
  warn?: number;
  onDemandWarn?: number;
  staleContent?: number;
  crit?: number;
} = {}): Record<string, unknown> {
  return {
    status: overrides.status ?? 'HEALTHY',
    checkedAt: overrides.checkedAt ?? new Date(NOW_MS).toISOString(),
    summary: {
      total: overrides.total ?? 6,
      ok: overrides.ok ?? 6,
      warn: overrides.warn ?? 0,
      onDemandWarn: overrides.onDemandWarn ?? 0,
      staleContent: overrides.staleContent ?? 0,
      crit: overrides.crit ?? 0,
    },
  };
}

describe('TOPMAN health classification', () => {
  it('shows healthy only when every check is fresh and OK', () => {
    const snapshot = classifyTopmanHealthPayload(healthPayload(), NOW_MS);

    assert.equal(snapshot.state, 'healthy');
    assert.equal(snapshot.summary.ok, 6);
  });

  it('never shows healthy when any critical check exists', () => {
    const partial = classifyTopmanHealthPayload(healthPayload({
      status: 'UNHEALTHY',
      ok: 2,
      crit: 4,
    }), NOW_MS);
    const unavailable = classifyTopmanHealthPayload(healthPayload({
      status: 'UNHEALTHY',
      ok: 0,
      crit: 6,
    }), NOW_MS);

    assert.equal(partial.state, 'partial');
    assert.notEqual(partial.state, 'healthy');
    assert.equal(unavailable.state, 'unavailable');
  });

  it('distinguishes stale warnings from on-demand partial coverage', () => {
    const stale = classifyTopmanHealthPayload(healthPayload({
      status: 'WARNING',
      ok: 4,
      warn: 2,
      staleContent: 2,
    }), NOW_MS);
    const invalidOnDemand = classifyTopmanHealthPayload(healthPayload({
      status: 'HEALTHY',
      ok: 5,
      onDemandWarn: 1,
    }), NOW_MS);
    const nonStaleWarning = classifyTopmanHealthPayload(healthPayload({
      status: 'WARNING',
      ok: 4,
      warn: 2,
    }), NOW_MS);

    assert.equal(stale.state, 'stale');
    assert.equal(invalidOnDemand.state, 'unavailable');
    assert.equal(nonStaleWarning.state, 'partial');
  });

  it('marks otherwise healthy data stale after five minutes', () => {
    const snapshot = classifyTopmanHealthPayload(healthPayload({
      checkedAt: new Date(NOW_MS - 5 * 60_000 - 1).toISOString(),
    }), NOW_MS);
    const oldCriticalSnapshot = classifyTopmanHealthPayload(healthPayload({
      status: 'UNHEALTHY',
      checkedAt: new Date(NOW_MS - 5 * 60_000 - 1).toISOString(),
      ok: 2,
      crit: 4,
    }), NOW_MS);

    assert.equal(snapshot.state, 'stale');
    assert.equal(oldCriticalSnapshot.state, 'stale');
  });

  it('fails closed for malformed or contradictory payloads', () => {
    const malformed = classifyTopmanHealthPayload({ status: 'HEALTHY' }, NOW_MS);
    const contradictory = classifyTopmanHealthPayload(healthPayload({
      ok: 6,
      warn: 1,
    }), NOW_MS);
    const unknown = classifyTopmanHealthPayload(healthPayload({
      status: 'SURPRISINGLY_FINE',
    }), NOW_MS);

    assert.equal(malformed.state, 'unavailable');
    assert.equal(contradictory.state, 'unavailable');
    assert.equal(unknown.state, 'unavailable');
  });

  it('accepts only the dedicated TOPMAN Core 6 summary contract', () => {
    for (const total of [5, 10]) {
      const snapshot = classifyTopmanHealthPayload(healthPayload({
        total,
        ok: total,
      }), NOW_MS);
      assert.equal(snapshot.state, 'unavailable');
    }
  });
});

describe('TOPMAN health transport and presentation', () => {
  it('reads the dedicated TOPMAN core status endpoint by default', async () => {
    let requestedUrl = '';
    await fetchTopmanHealthSnapshot({
      fetchFn: (async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return {
          ok: true,
          status: 200,
          json: async () => healthPayload(),
        } as Response;
      }) as typeof fetch,
      now: () => NOW_MS,
    });

    assert.equal(requestedUrl, '/api/topman-core-status');
  });

  it('fails closed on transport and non-2xx failures', async () => {
    const transportFailure = await fetchTopmanHealthSnapshot({
      fetchFn: (async () => {
        throw new Error('network unavailable');
      }) as typeof fetch,
      now: () => NOW_MS,
    });
    const httpFailure = await fetchTopmanHealthSnapshot({
      fetchFn: (async () => ({
        ok: false,
        status: 500,
        json: async () => healthPayload(),
      } as Response)) as typeof fetch,
      now: () => NOW_MS,
    });

    assert.equal(transportFailure.state, 'unavailable');
    assert.equal(httpFailure.state, 'unavailable');
  });

  it('bounds a hung health request and aborts its transport', async () => {
    let receivedSignal: AbortSignal | undefined;
    const startedAt = Date.now();
    const snapshot = await fetchTopmanHealthSnapshot({
      fetchFn: ((_: RequestInfo | URL, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }) as typeof fetch,
      now: () => NOW_MS,
      timeoutMs: 10,
    });

    assert.equal(snapshot.state, 'unavailable');
    assert.equal(receivedSignal?.aborted, true);
    assert.ok(Date.now() - startedAt < 500, 'hung request should resolve at the configured timeout');
  });

  it('accepts the intentional REDIS_DOWN 503 as unavailable health', async () => {
    const snapshot = await fetchTopmanHealthSnapshot({
      fetchFn: (async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          status: 'REDIS_DOWN',
          checkedAt: new Date(NOW_MS).toISOString(),
        }),
      } as Response)) as typeof fetch,
      now: () => NOW_MS,
    });

    assert.equal(snapshot.state, 'unavailable');
    assert.equal(snapshot.sourceStatus, 'REDIS_DOWN');
  });

  it('provides Thai, bilingual, and English labels with accessible counts', () => {
    const snapshot = classifyTopmanHealthPayload(healthPayload({
      status: 'UNHEALTHY',
      ok: 2,
      crit: 4,
    }), NOW_MS);
    const presentation = buildTopmanHealthPresentation(snapshot, 'bilingual');

    assert.equal(formatTopmanHealthLabel('partial', 'th'), 'ข้อมูลหลักบางส่วน');
    assert.equal(formatTopmanHealthLabel('partial', 'bilingual'), 'ข้อมูลหลักบางส่วน / Core partial');
    assert.equal(formatTopmanHealthLabel('partial', 'en'), 'Core partial');
    assert.match(presentation.description, /TOPMAN Core 6 ชุด\/lanes/);
    assert.match(presentation.description, /พร้อม\/OK 2\/6/);
    assert.match(presentation.description, /วิกฤต\/Critical 4/);
    assert.match(presentation.description, /ตรวจล่าสุด/);
    assert.match(presentation.description, /Last checked/);
  });

  it('links to the exact TOPMAN commit when the build hash is available', () => {
    assert.equal(
      getTopmanSourceHref('ABCDEF123456'),
      'https://github.com/Topman3579/topmanidmb-world-monitor/commit/abcdef123456',
    );
    assert.equal(
      getTopmanSourceHref('development'),
      'https://github.com/Topman3579/topmanidmb-world-monitor',
    );
  });

  it('polls on the established five-minute health cadence', () => {
    assert.equal(TOPMAN_HEALTH_POLL_INTERVAL_MS, 5 * 60_000);
  });
});
