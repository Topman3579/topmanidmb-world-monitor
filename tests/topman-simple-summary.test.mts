import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertSummaryIsDataBacked,
  buildSimpleExecutiveSummary,
  formatSimpleDataStatusLabel,
  formatSimpleGeneratedFromLabel,
  mapHealthToSimpleStatus,
} from '../src/services/topman-simple-summary.ts';
import type { ServerInsights } from '../src/services/insights-loader.ts';
import type {
  SystemHealthBrief,
  TopmanHealthSnapshot,
} from '../src/services/topman-health-status.ts';

const healthy: TopmanHealthSnapshot = {
  state: 'healthy',
  sourceStatus: 'HEALTHY',
  summary: { total: 6, ok: 6, warn: 0, onDemandWarn: 0, staleContent: 0, crit: 0 },
  checkedAtMs: Date.now(),
};

const partialUnhealthy: TopmanHealthSnapshot = {
  state: 'partial',
  sourceStatus: 'UNHEALTHY',
  summary: { total: 6, ok: 4, warn: 0, onDemandWarn: 0, staleContent: 0, crit: 2 },
  checkedAtMs: Date.now(),
};

const systemHealthy: SystemHealthBrief = {
  state: 'healthy',
  sourceStatus: 'HEALTHY',
  ok: 232,
  total: 232,
  crit: 0,
  checkedAtMs: Date.now(),
};

const systemUnhealthy: SystemHealthBrief = {
  state: 'partial',
  sourceStatus: 'UNHEALTHY',
  ok: 17,
  total: 232,
  crit: 165,
  checkedAtMs: Date.now(),
};

function sampleInsights(overrides: Partial<ServerInsights> = {}): ServerInsights {
  return {
    worldBrief: 'Major powers held talks. Markets moved on energy news. Storms hit coastal regions.',
    briefProvider: 'test',
    status: 'ok',
    generatedAt: new Date().toISOString(),
    clusterCount: 3,
    multiSourceCount: 2,
    fastMovingCount: 1,
    topStories: [
      {
        primaryTitle: 'Energy markets react to supply risk',
        primarySource: 'Reuters',
        primaryLink: 'https://example.test/1',
        pubDate: new Date().toISOString(),
        sourceCount: 4,
        importanceScore: 0.8,
        velocity: { level: 'high', sourcesPerHour: 2 },
        isAlert: false,
        category: 'markets',
        threatLevel: 'elevated',
        countryCode: null,
      },
      {
        primaryTitle: 'Thailand monitors regional weather and sea routes',
        primarySource: 'Bangkok Post',
        primaryLink: 'https://example.test/2',
        pubDate: new Date().toISOString(),
        sourceCount: 2,
        importanceScore: 0.6,
        velocity: { level: 'medium', sourcesPerHour: 1 },
        isAlert: false,
        category: 'asia',
        threatLevel: 'watch',
        countryCode: 'TH',
      },
      {
        primaryTitle: 'Multi-source conflict alert near chokepoint',
        primarySource: 'AP',
        primaryLink: 'https://example.test/3',
        pubDate: new Date().toISOString(),
        sourceCount: 5,
        importanceScore: 0.9,
        velocity: { level: 'high', sourcesPerHour: 3 },
        isAlert: true,
        category: 'conflict',
        threatLevel: 'critical',
        countryCode: null,
      },
    ],
    ...overrides,
  };
}

describe('topman-simple-summary', () => {
  it('maps TOPMAN core health without claiming full-system completeness', () => {
    assert.equal(mapHealthToSimpleStatus(healthy), 'ready');
    assert.equal(mapHealthToSimpleStatus(partialUnhealthy), 'partial');
    assert.equal(mapHealthToSimpleStatus(null), 'unavailable');
    assert.match(formatSimpleDataStatusLabel('ready'), /ข้อมูลหลักพร้อม|Core ready/);
    assert.match(formatSimpleDataStatusLabel('partial'), /ข้อมูลหลักบางส่วน|Core partial/);
    assert.match(formatSimpleGeneratedFromLabel('topman-core-status'), /ข้อมูลหลัก|Core/);
  });

  it('builds three cards from verified insights only', () => {
    const summary = buildSimpleExecutiveSummary({
      insights: sampleInsights(),
      health: healthy,
      systemHealth: systemHealthy,
    });
    assert.equal(summary.cards.length, 3);
    assert.equal(summary.cards[0]!.id, 'world');
    assert.equal(summary.cards[1]!.id, 'asean');
    assert.equal(summary.cards[2]!.id, 'watch');
    assert.ok(summary.cards[0]!.summary.includes('Major powers') || summary.cards[0]!.summary.length > 10);
    assert.match(summary.cards[1]!.summary, /Thailand|ไทย|ASEAN|อาเซียน/i);
    assert.match(summary.cards[2]!.summary, /conflict|chokepoint|Multi-source/i);
    assert.ok(summary.generatedFrom.includes('server-insights'));
    assert.equal(summary.generatedFromLabels.length, summary.generatedFrom.length);
    assert.match(summary.coreStrip, /6|TOPMAN/);
    assert.match(summary.systemStrip, /232|ระบบเต็ม|Full system/);
    assert.match(summary.healthScopeNote, /คนละชั้น|separate layers/);
    assert.ok(assertSummaryIsDataBacked(summary));
  });

  it('never invents ASEAN impact when no matching stories exist', () => {
    const summary = buildSimpleExecutiveSummary({
      insights: sampleInsights({
        topStories: [
          {
            primaryTitle: 'European markets close mixed',
            primarySource: 'FT',
            primaryLink: 'https://example.test/eu',
            pubDate: new Date().toISOString(),
            sourceCount: 1,
            importanceScore: 0.4,
            velocity: { level: 'low', sourcesPerHour: 0.2 },
            isAlert: false,
            category: 'markets',
            threatLevel: 'low',
            countryCode: 'DE',
          },
        ],
      }),
      health: healthy,
      systemHealth: systemHealthy,
    });
    assert.match(summary.cards[1]!.summary, /ยังไม่พบ|no items clearly|not|ไม่มี/i);
    assert.equal(summary.cards[1]!.level, 'unknown');
  });

  it('shows honest unavailable state when insights missing', () => {
    const summary = buildSimpleExecutiveSummary({
      insights: null,
      health: partialUnhealthy,
      systemHealth: systemUnhealthy,
    });
    assert.equal(summary.status, 'partial');
    assert.ok(summary.cards.every((c) => c.level === 'unknown'));
    assert.match(summary.body, /จะไม่เดา|will not invent/i);
  });

  it('downgrades overall readiness when core health is UNHEALTHY/partial', () => {
    const summary = buildSimpleExecutiveSummary({
      insights: sampleInsights(),
      health: partialUnhealthy,
      systemHealth: systemHealthy,
    });
    assert.equal(summary.status, 'partial');
  });

  it('downgrades Core-ready badge when full-system compact health is degraded', () => {
    const summary = buildSimpleExecutiveSummary({
      insights: sampleInsights(),
      health: healthy,
      systemHealth: systemUnhealthy,
    });
    assert.equal(summary.status, 'partial');
    assert.match(summary.systemStrip, /17\/232|ไม่พร้อม|not ready|critical/);
  });
});
