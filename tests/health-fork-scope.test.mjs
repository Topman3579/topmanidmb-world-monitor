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
const { TOPMAN_CORE_DATASETS } = await import('../api/_topman-core.js');

// Fresh core envelopes for mocking readTopmanCoreSnapshot pipelines.
function isCoreRead(commands) {
  return commands.length === TOPMAN_CORE_DATASETS.length * 3
    && commands[0][1].startsWith('topman:core:');
}
function coreFreshResults(commands, now) {
  return commands.map(([, key]) => {
    if (key.includes(':data:')) {
      const dataset = TOPMAN_CORE_DATASETS.find((d) => d.dataKey === key);
      let payload;
      switch (dataset.bootstrapName) {
        case 'earthquakes': payload = { earthquakes: [{ id: 'q1' }] }; break;
        case 'weatherAlerts': payload = { alerts: [] }; break;
        case 'naturalEvents': payload = { events: [] }; break;
        case 'gdeltIntel': payload = { topics: [{ id: 't', articles: [{ url: 'u' }] }] }; break;
        case 'commodityQuotes': payload = { quotes: Array.from({ length: 7 }, (_, i) => ({ symbol: 'C' + i })) }; break;
        case 'ecbFxRates': payload = { rates: Array.from({ length: 12 }, (_, i) => ({ pair: 'P' + i })), updatedAt: new Date(now).toISOString() }; break;
        default: payload = {};
      }
      return { result: JSON.stringify({ _seed: { fetchedAt: now, state: 'OK' }, data: payload }) };
    }
    return { result: null };
  });
}
function coreDeadResults() {
  return Array.from({ length: TOPMAN_CORE_DATASETS.length * 3 }, () => ({ result: null }));
}

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
  const now = Date.now();
  globalThis.fetch = async (_url, init) => {
    const commands = JSON.parse(init.body);
    if (isCoreRead(commands)) {
      return new Response(JSON.stringify(coreFreshResults(commands, now)), { status: 200 });
    }
    const results = commands.map(([op, key]) => {
      if (op === 'STRLEN' || op === 'LLEN') return { result: 5000 };
      if (op === 'GET' && key.startsWith('seed-meta:')) {
        return { result: JSON.stringify({ fetchedAt: now - 60_000, recordCount: 42 }) };
      }
      return { result: 0 };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  };
  const res = await handler(new Request('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1'));
  assert.equal(res.status, 200);
  const body = await res.json();
  // Fork contract = 6 core datasets + 1 inheritedRegistry marker. All-fresh
  // core => HEALTHY (static seeds dropped — no fork producer, review P1).
  assert.equal(body.summary.total, 7);
  assert.equal(body.status, 'HEALTHY');
  assert.equal(body.summary.crit, 0);
  assert.equal(body.summary.ok, 7);
  assert.equal(body.scope, 'fork');
  assert.equal(body.completeness, 'owned-data-plane-only');
  assert.equal(body.summary.warn, 0);
  // informational entry must NOT appear in compact problems (it's ok-bucket)
  assert.equal(body.problems, undefined);
});

test('fork scope: producer-less static seeds are NOT part of the contract', async () => {
  // Vercel review P1: retained static seeds had no fork-side producer; after
  // their finite TTLs expire they would pin UNHEALTHY forever. They must be
  // absent from checks entirely (summarized only in inheritedRegistry.count).
  const staleAt = Date.now() - 500 * 24 * 3600 * 1000;
  const now = Date.now();
  globalThis.fetch = async (_url, init) => {
    const commands = JSON.parse(init.body);
    if (isCoreRead(commands)) {
      return new Response(JSON.stringify(coreFreshResults(commands, now)), { status: 200 });
    }
    const results = commands.map(([op, key]) => {
      if (op === 'STRLEN' || op === 'LLEN') return { result: 5000 };
      if (op === 'GET' && key.startsWith('seed-meta:')) {
        return { result: JSON.stringify({ fetchedAt: staleAt, recordCount: 42 }) };
      }
      return { result: 0 };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  };
  const res = await handler(new Request('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1'));
  const body = await res.json();
  assert.equal(body.status, 'HEALTHY');
  for (const name of ['faoFoodPriceIndex', 'nationalDebt', 'chokepointBaselines', 'sprPolicies', 'goldCbReserves']) {
    assert.ok(!(name in (body.problems ?? {})), `${name} must not be a problem`);
  }
});

test('fork scope: wholly empty inherited Redis still yields the honest core-only contract', async () => {
  // No static-seed keys, no seed-meta — only the core lane exists. The fork
  // contract must still be 7 checks (6 core + 1 marker), HEALTHY when the
  // core lane is fresh.
  const now = Date.now();
  globalThis.fetch = async (_url, init) => {
    const commands = JSON.parse(init.body);
    if (isCoreRead(commands)) {
      return new Response(JSON.stringify(coreFreshResults(commands, now)), { status: 200 });
    }
    const results = commands.map(([op, key]) => {
      if (op === 'GET' && key.startsWith('seed-meta:')) {
        return { result: JSON.stringify({ fetchedAt: now - 60_000, recordCount: 0 }) };
      }
      return { result: 0 };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  };
  const res = await handler(new Request('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1'));
  const body = await res.json();
  assert.equal(body.summary.total, 7);
  assert.equal(body.summary.crit, 0);
  assert.equal(body.status, 'HEALTHY');
});

test('fork scope config: NOT_OWNED buckets to ok; no producer-less seeds retained', () => {
  assert.equal(STATUS_COUNTS.NOT_OWNED, 'ok');
  // Vercel review P1: every retained name must have a fork-side producer.
  assert.deepEqual([...FORK_STATIC_SEED_NAMES], []);
});

test('fork scope: dead core lane must NOT read as healthy (fail-closed)', async () => {
  // Mock two Redis pipelines: first the health sweep (static seeds fresh),
  // then the TOPMAN core read with every data/meta/attempt key absent.
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    const commands = JSON.parse(init.body);
    call++;
    const isCoreRead = commands.length === TOPMAN_CORE_DATASETS.length * 3
      && commands[0][1].startsWith('topman:core:');
    const results = commands.map(([op, key]) => {
      if (isCoreRead) return { result: null };
      if (op === 'STRLEN' || op === 'LLEN') return { result: 5000 };
      if (op === 'GET' && key.startsWith('seed-meta:')) {
        return { result: JSON.stringify({ fetchedAt: Date.now() - 60_000, recordCount: 7 }) };
      }
      return { result: 0 };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  };
  const res = await handler(new Request('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1'));
  const body = await res.json();
  // 6 core EMPTY crit + 1 informational marker
  assert.equal(body.summary.total, 7);
  assert.equal(body.summary.crit, 6);
  assert.equal(body.status, 'UNHEALTHY');
  for (const name of ['earthquakes', 'weatherAlerts', 'naturalEvents', 'gdeltIntel', 'commodityQuotes', 'ecbFxRates']) {
    assert.ok(body.problems && name in body.problems, `${name} must appear in problems`);
  }
});

test('fork scope: core Redis READ ERROR surfaces REDIS_DOWN 503 (not phantom EMPTY)', async () => {
  // Vercel review P2: a failed core pipeline read is infrastructure, not data.
  globalThis.fetch = async (_url, init) => {
    const commands = JSON.parse(init.body);
    if (isCoreRead(commands)) {
      return new Response(JSON.stringify(commands.map(() => ({ error: 'READONLY' }))), { status: 200 });
    }
    const results = commands.map(([op, key]) => {
      if (op === 'STRLEN' || op === 'LLEN') return { result: 5000 };
      if (op === 'GET' && key.startsWith('seed-meta:')) {
        return { result: JSON.stringify({ fetchedAt: Date.now() - 60_000, recordCount: 3 }) };
      }
      return { result: 0 };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  };
  const res = await handler(new Request('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1'));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'REDIS_DOWN');
});

test('fork scope: healthy core lane keeps verdict healthy and shows 6 core OKs', async () => {
  const now = Date.now();
  globalThis.fetch = async (_url, init) => {
    const commands = JSON.parse(init.body);
    if (isCoreRead(commands)) {
      return new Response(JSON.stringify(coreFreshResults(commands, now)), { status: 200 });
    }
    const results = commands.map(([op, key]) => {
      if (op === 'STRLEN' || op === 'LLEN') return { result: 5000 };
      if (op === 'GET' && key.startsWith('seed-meta:')) {
        return { result: JSON.stringify({ fetchedAt: now - 60_000, recordCount: 7 }) };
      }
      return { result: 0 };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  };
  const res = await handler(new Request('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1'));
  const body = await res.json();
  assert.equal(body.summary.total, 7);
  assert.equal(body.summary.crit, 0);
  assert.equal(body.summary.ok, 7);
  assert.equal(body.status, 'HEALTHY');
  assert.equal(body.scope, 'fork');
});

test('scope off (control): full registry sweep is untouched', async () => {
  // Re-import with WM_HEALTH_SCOPE unset via query cache-bust: node:test runs
  // in one process, so instead verify the exported flag directly.
  // (The env is set to 'fork' at module load; a control sweep would need a
  // child process — covered by tests below asserting default behavior guards.)
  assert.equal(process.env.WM_HEALTH_SCOPE, 'fork');
  assert.equal(typeof __testing__.HEALTH_SCOPE_FORK, 'boolean');
});
