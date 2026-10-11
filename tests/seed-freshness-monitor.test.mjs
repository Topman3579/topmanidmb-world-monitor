import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  findStaleSeedProblems,
  healthRequestHeaders,
  isUpstreamWorldMonitorHost,
  planSeedFreshnessCheck,
  validateCompactHealthPayload,
  VERCEL_PROTECTION_BYPASS_HEADER,
} from '../scripts/check-seed-freshness.mjs';

describe('scheduled seed freshness monitor', () => {
  it('alerts only when seed metadata has exceeded maxStaleMin', () => {
    const payload = {
      status: 'UNHEALTHY',
      checkedAt: '2026-07-13T17:45:19.746Z',
      summary: { total: 4, ok: 0, warn: 2, onDemandWarn: 0, staleContent: 0, crit: 2 },
      problems: {
        wildfire: { status: 'STALE_SEED', seedAgeMin: 361, maxStaleMin: 360 },
        frozenFeed: { status: 'STALE_CONTENT', contentAgeMin: 91, maxContentAgeMin: 90 },
        emptyFeed: { status: 'EMPTY', records: 0, maxStaleMin: 180 },
        failedFeed: { status: 'SEED_ERROR', records: 1, maxStaleMin: 120 },
      },
    };

    assert.deepEqual(findStaleSeedProblems(payload), [
      {
        name: 'wildfire',
        seedAgeMin: 361,
        maxStaleMin: 360,
      },
    ]);
  });

  it('rejects payloads that cannot prove compact seed freshness', () => {
    assert.throws(() => validateCompactHealthPayload(null), /object/);
    assert.deepEqual(findStaleSeedProblems({ status: 'HEALTHY' }), []);
    assert.throws(() => validateCompactHealthPayload({ status: 'WARNING' }), /problems/);
    assert.throws(
      () => validateCompactHealthPayload({ status: 'HEALTHY', problems: [] }),
      /problems/,
    );
  });

  it('runs on a schedule, skips non-green main, and invokes the monitor script', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/seed-freshness-monitor.yml', import.meta.url),
      'utf8',
    );

    assert.match(workflow, /schedule:/);
    assert.match(workflow, /cron:\s*['"]17 \* \* \* \*['"]/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /actions\/setup-node@[a-f0-9]+/);
    assert.match(workflow, /node-version:\s*['"]24['"]/);
    assert.match(workflow, /context\s*==\s*"gate"/);
    assert.match(workflow, /gate_state.*success/s);
    assert.match(workflow, /HEALTH_URL:\s*\$\{\{\s*vars\.HEALTH_URL\s*\}\}/);
    assert.match(workflow, /VERCEL_AUTOMATION_BYPASS_SECRET:\s*\$\{\{\s*secrets\.VERCEL_AUTOMATION_BYPASS_SECRET\s*\}\}/);
    assert.match(workflow, /node scripts\/check-seed-freshness\.mjs/);
    assert.doesNotMatch(workflow, /https?:\/\/(?:[a-z0-9-]+\.)*worldmonitor\.app/);
  });

  it('does not check anything when HEALTH_URL is unset', () => {
    for (const value of [undefined, '', '   ']) {
      const plan = planSeedFreshnessCheck(value);
      assert.equal(plan.action, 'skip');
      assert.match(plan.notice, /::notice::/);
      assert.match(plan.notice, /disabled until HEALTH_URL is configured/);
      assert.match(plan.notice, /WM_HEALTH_SCOPE=fork/);
      assert.match(plan.notice, /api\/health\.js/);
      assert.equal(plan.url, undefined);
    }
  });

  it('rejects the upstream worldmonitor.app host and its subdomains', () => {
    const rejected = [
      'https://api.worldmonitor.app/api/health?compact=1',
      'https://worldmonitor.app/api/health',
      'https://www.worldmonitor.app/api/health',
      'https://API.WorldMonitor.App/api/health',
      'http://seed.api.worldmonitor.app/health',
    ];
    for (const healthUrl of rejected) {
      const plan = planSeedFreshnessCheck(healthUrl);
      assert.equal(plan.action, 'reject', healthUrl);
      assert.match(plan.error, /must not be checked/);
      assert.equal(plan.url, undefined);
    }

    assert.equal(isUpstreamWorldMonitorHost('worldmonitor.app'), true);
    assert.equal(isUpstreamWorldMonitorHost('api.worldmonitor.app.'), true);
    assert.equal(isUpstreamWorldMonitorHost('notworldmonitor.app'), false);
    assert.equal(isUpstreamWorldMonitorHost('worldmonitor.app.example.com'), false);

    const allowed = planSeedFreshnessCheck('https://topmanidmb-world-monitor.vercel.app/api/health?compact=1');
    assert.equal(allowed.action, 'fetch');
    assert.equal(allowed.url, 'https://topmanidmb-world-monitor.vercel.app/api/health?compact=1');
  });

  it('sends the Vercel bypass header without putting the secret in the plan', () => {
    const secret = 'bypass-secret-should-not-leak';
    const headers = healthRequestHeaders(secret);
    assert.equal(headers[VERCEL_PROTECTION_BYPASS_HEADER], secret);
    assert.equal(healthRequestHeaders('')[VERCEL_PROTECTION_BYPASS_HEADER], undefined);
    assert.equal(healthRequestHeaders('   ')[VERCEL_PROTECTION_BYPASS_HEADER], undefined);
    assert.equal(healthRequestHeaders(undefined)[VERCEL_PROTECTION_BYPASS_HEADER], undefined);

    const plan = planSeedFreshnessCheck('');
    assert.equal(JSON.stringify(plan).includes(secret), false);
    const source = readFileSync(new URL('../scripts/check-seed-freshness.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /https?:\/\/(?:[a-z0-9-]+\.)*worldmonitor\.app/);
    assert.doesNotMatch(source, /console\.(?:log|error|warn|info)\([\s\S]*bypassSecret/);
  });
});
