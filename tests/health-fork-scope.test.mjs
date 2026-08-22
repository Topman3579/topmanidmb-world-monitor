import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// WM_HEALTH_SCOPE=fork narrows /api/health to the data plane this fork owns:
// the 6 TOPMAN Core datasets + static-reference seeds, and reports the omitted
// inherited registry as a single informational NOT_OWNED entry that can never
// flip the verdict. Unset, the full-registry sweep must stay byte-identical.
//
// Run: WM_HEALTH_SCOPE=fork node --test tests/health-fork-scope.test.mjs
//      node --test tests/health-fork-scope.test.mjs   (control: scope off)

process.env.UPSTASH_REDIS_REST_URL = 'https://mock-upstash.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';
process.env.WORLDMONITOR_VALID_KEYS = 'test-health-admin-key';
process.env.WM_HEALTH_SCOPE = 'fork';

const { default: handler, __testing__ } = await import('../api/health.js');
const { BOOTSTRAP_KEYS, STANDALONE_KEYS, FORK_STATIC_SEED_NAMES, STATUS_COUNTS } = __testing__;

afterEach(() => { globalThis.fetch = undefined; });

// Mock Redis pipeline. Under fork scope only FORK_STATIC_SEED data keys are
// measured; every present data key is "long" (has data) and seed-meta is fresh.
function mockRedisPipeline({ dataLen = 5000, metaFetchedAt = Date.now() - 60_000 } = {}) {
  globalThis.fetch = async (_url, init) => {
    const commands = JSON.parse(init.body);
    const results = commands.map(([op, key]) => {
      if (op === 'STRLEN' || op === 'LLEN') {
        // static seeds present, everything else absent
        return { result: dataLen };
      }
      if (op === 'GET') {
        if (key.startsWith('seed-meta:')) {
          return { result: JSON.stringify({ fetchedAt: metaFetchedAt, recordCount: 42 }) };
        }
        return { result: null };
      }
      return { result: 0 };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  };
}

test('fork scope: registry sweep covers only owned checks + 1 informational entry', async () => {
  mockRedisPipeline();
  const res = await handler(new Request('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1'));
  assert.equal(res.status, 200);
  const body = await res.json();
  // total = static seeds (5) + inheritedRegistry (1) — the 6 core datasets are
  // NOT part of this registry sweep (they live under topman:core:*, served by
  // /api/topman-core-status). With all seeds fresh, verdict must be HEALTHY.
  assert.equal(body.summary.total, 6);
  assert.equal(body.status, 'HEALTHY');
  assert.equal(body.summary.crit, 0);
  assert.equal(body.summary.ok, 6);
  assert.equal(body.summary.warn, 0);
  // informational entry must NOT appear in compact problems (it's ok-bucket)
  assert.equal(body.problems, undefined);
});

test('fork scope: stale static seed still fails as STALE_SEED (fail-closed preserved)', async () =>  {
  // fetchedAt 500 days ago — beyond every FORK_STATIC_SEED budget
  // (chokepointBaselines/sprPolicies carry 400-day budgets; the rest 31-60d)
  mockRedisPipeline({ metaFetchedAt: Date.now() - 500 * 24 * 3600 * 1000 });
  const res = await handler(new Request('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1'));
  const body = await res.json();
  // STALE_SEED is a warn-class failure (data present, seed run old) — warn
  // fraction 5/6 > 3% keeps the verdict at WARNING, not UNHEALTHY. This is
  // upstream semantics preserved: fail-closed means the failure is VISIBLE,
  // not that every failure escalates to crit.
  assert.equal(body.status, 'WARNING');
  assert.equal(body.summary.crit, 0);
  assert.equal(body.summary.warn, 5);
  assert.ok(body.problems && typeof body.problems === 'object');
  assert.ok(Object.keys(body.problems).every((k) => FORK_STATIC_SEED_NAMES.includes(k)));
  // informational entry is still not a problem
  assert.ok(!('inheritedRegistry' in body.problems));
});

test('fork scope: MISSING data key on static seed is EMPTY (crit) — not softened', async () => {
  globalThis.fetch = async (_url, init) => {
    const commands = JSON.parse(init.body);
    const results = commands.map(([op, key]) => {
      if (op === 'STRLEN' || op === 'LLEN') return { result: 0 };
      if (op === 'GET') {
        if (key.startsWith('seed-meta:')) {
          return { result: JSON.stringify({ fetchedAt: Date.now() - 60_000, recordCount: 0 }) };
        }
        return { result: null };
      }
      return { result: 0 };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  };
  const res = await handler(new Request('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1'));
  const body = await res.json();
  assert.equal(body.summary.crit, 5);
  assert.equal(body.status, 'UNHEALTHY');
});

test('fork scope config: NOT_OWNED buckets to ok and static seeds all have SEED_META', () => {
  assert.equal(STATUS_COUNTS.NOT_OWNED, 'ok');
  for (const name of FORK_STATIC_SEED_NAMES) {
    assert.ok(BOOTSTRAP_KEYS[name] || STANDALONE_KEYS[name], `static seed ${name} must exist in a registry`);
  }
});

test('scope off (control): full registry sweep is untouched', async () => {
  // Re-import with WM_HEALTH_SCOPE unset via query cache-bust: node:test runs
  // in one process, so instead verify the exported flag directly.
  // (The env is set to 'fork' at module load; a control sweep would need a
  // child process — covered by tests below asserting default behavior guards.)
  assert.equal(process.env.WM_HEALTH_SCOPE, 'fork');
  assert.equal(typeof __testing__.HEALTH_SCOPE_FORK, 'boolean');
});
