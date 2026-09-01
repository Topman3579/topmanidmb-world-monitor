import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TOPMAN_CORE_DATASETS,
  corePayloadForDailyBrief,
  isTopmanCoreDataUsable,
  loadTopmanCoreForBrief,
  readTopmanCoreSnapshot,
  resolveTopmanCoreProjection,
  topmanCoreDataKey,
} from '../api/_topman-core.js';
import {
  TOPMAN_CORE_STATUS_CACHE_CONTROL,
  TOPMAN_CORE_STATUS_CDN_CACHE_CONTROL,
} from '../api/topman-core-status.js';

const NOW_MS = Date.parse('2026-07-30T03:00:00.000Z');

function healthyData(bootstrapName) {
  switch (bootstrapName) {
    case 'earthquakes':
      return { earthquakes: [{ id: 'quake-1' }] };
    case 'weatherAlerts':
      return { alerts: [] };
    case 'naturalEvents':
      return { events: [], fetchedAt: NOW_MS, dataAvailable: true };
    case 'gdeltIntel':
      return {
        topics: [{ id: 'intelligence', articles: [{ title: 'ASEAN update' }] }],
        fetchedAt: new Date(NOW_MS).toISOString(),
      };
    case 'commodityQuotes':
      return {
        quotes: Array.from({ length: 7 }, (_, index) => ({
          symbol: `Q${index}`,
          price: 100 + index,
        })),
      };
    case 'ecbFxRates':
      return {
        rates: Array.from({ length: 10 }, (_, index) => ({
          pair: `EURX${index}`,
          rate: 1 + index,
          date: '2026-07-30',
          change1d: 0,
        })),
        updatedAt: '2026-07-30',
        seededAt: String(NOW_MS),
        unavailable: false,
      };
    default:
      throw new Error(`Unknown bootstrap name: ${bootstrapName}`);
  }
}

function makePipeline(overrides = {}) {
  const values = new Map();
  for (const dataset of TOPMAN_CORE_DATASETS) {
    const data = healthyData(dataset.bootstrapName);
    values.set(dataset.dataKey, JSON.stringify({
      _seed: {
        fetchedAt: NOW_MS - 60_000,
        recordCount: dataset.bootstrapName === 'gdeltIntel'
          ? 1
          : dataset.bootstrapName === 'weatherAlerts' || dataset.bootstrapName === 'naturalEvents'
            ? 0
            : dataset.bootstrapName === 'commodityQuotes'
              ? 7
              : dataset.bootstrapName === 'ecbFxRates'
                ? 10
                : 1,
        sourceVersion: `test-${dataset.id}`,
        schemaVersion: 1,
        state: 'OK',
      },
      data,
    }));
    values.set(dataset.metaKey, JSON.stringify({
      fetchedAt: NOW_MS - 60_000,
      recordCount: JSON.parse(values.get(dataset.dataKey))._seed.recordCount,
      sourceVersion: `test-${dataset.id}`,
      coverage: dataset.id === 'commodities' ? 'full' : 'focused',
    }));
    values.set(dataset.attemptKey, null);
  }
  for (const [key, value] of Object.entries(overrides)) values.set(key, value);

  return async (commands) => commands.map((command) => ({
    result: values.get(command[1]) ?? null,
  }));
}

function cacheDirectiveSeconds(header, directive) {
  const match = header.match(new RegExp(`(?:^|,\\s*)${directive}=(\\d+)(?:,|$)`));
  return match ? Number(match[1]) : 0;
}

describe('TOPMAN core status', () => {
  it('keeps every cache-serving window below the five-minute consumer freshness gate', () => {
    const browserWindow = (
      cacheDirectiveSeconds(TOPMAN_CORE_STATUS_CACHE_CONTROL, 'max-age')
      + cacheDirectiveSeconds(TOPMAN_CORE_STATUS_CACHE_CONTROL, 'stale-while-revalidate')
      + cacheDirectiveSeconds(TOPMAN_CORE_STATUS_CACHE_CONTROL, 'stale-if-error')
    );
    const cdnWindow = (
      cacheDirectiveSeconds(TOPMAN_CORE_STATUS_CDN_CACHE_CONTROL, 's-maxage')
      + cacheDirectiveSeconds(TOPMAN_CORE_STATUS_CDN_CACHE_CONTROL, 'stale-while-revalidate')
      + cacheDirectiveSeconds(TOPMAN_CORE_STATUS_CDN_CACHE_CONTROL, 'stale-if-error')
    );

    assert.ok(browserWindow < 5 * 60, `browser cache window ${browserWindow}s exceeds Core 6 freshness`);
    assert.ok(cdnWindow < 5 * 60, `CDN cache window ${cdnWindow}s exceeds Core 6 freshness`);
  });

  it('keeps every focused key isolated and maps all six bootstrap contracts', () => {
    assert.equal(TOPMAN_CORE_DATASETS.length, 6);
    for (const dataset of TOPMAN_CORE_DATASETS) {
      assert.match(dataset.dataKey, /^topman:core:data:/);
      assert.match(dataset.metaKey, /^topman:core:meta:/);
      assert.match(dataset.attemptKey, /^topman:core:attempt:/);
      assert.equal(topmanCoreDataKey(dataset.bootstrapName), dataset.dataKey);
      assert.equal(isTopmanCoreDataUsable(dataset.bootstrapName, healthyData(dataset.bootstrapName)), true);
    }
    assert.equal(topmanCoreDataKey('unknown'), null);
    assert.equal(isTopmanCoreDataUsable('ecbFxRates', { USD: 1, EUR: 1.1 }), false);
  });

  it('reports healthy only when all six focused datasets are fresh and usable', async () => {
    const snapshot = await readTopmanCoreSnapshot({
      includeData: true,
      executePipeline: makePipeline(),
      now: () => NOW_MS,
    });

    assert.equal(snapshot.status, 'HEALTHY');
    assert.deepEqual(snapshot.summary, {
      total: 6,
      ok: 6,
      warn: 0,
      onDemandWarn: 0,
      staleContent: 0,
      crit: 0,
    });
    const briefCore = corePayloadForDailyBrief(snapshot);
    assert.ok(briefCore);
    assert.equal(briefCore.earthquakes, snapshot.data.earthquakes);
    assert.equal(briefCore.commodities, snapshot.data.commodityQuotes);
    assert.equal(briefCore.fxRates, snapshot.data.ecbFxRates);

    assert.deepEqual(Object.keys(snapshot.data).sort(), [
      'commodityQuotes',
      'earthquakes',
      'ecbFxRates',
      'gdeltIntel',
      'naturalEvents',
      'weatherAlerts',
    ]);
  });

  it('merges focused rows without shrinking broader canonical coverage', () => {
    const canonical = {
      _seed: {
        fetchedAt: NOW_MS - 60_000,
        recordCount: 3,
        state: 'OK',
      },
      data: {
        quotes: [
          { symbol: 'GC=F', price: 100 },
          { symbol: 'CL=F', price: 70 },
          { symbol: 'NG=F', price: 3 },
        ],
      },
    };
    const focused = {
      _seed: {
        fetchedAt: NOW_MS,
        recordCount: 3,
        state: 'OK',
      },
      data: {
        quotes: [
          { symbol: 'GC=F', price: 101 },
          { symbol: '^VIX', price: 16 },
          { symbol: 'BZ=F', price: 74 },
        ],
      },
    };

    assert.deepEqual(
      resolveTopmanCoreProjection('commodityQuotes', canonical, focused, NOW_MS),
      {
        quotes: [
          { symbol: 'GC=F', price: 101 },
          { symbol: '^VIX', price: 16 },
          { symbol: 'BZ=F', price: 74 },
          { symbol: 'CL=F', price: 70 },
          { symbol: 'NG=F', price: 3 },
        ],
      },
    );
  });

  it('keeps canonical rows authoritative when focused coverage is partial', () => {
    const canonical = {
      _seed: { fetchedAt: NOW_MS - 60_000, recordCount: 3, state: 'OK' },
      data: {
        quotes: [
          { symbol: 'GC=F', price: 100 },
          { symbol: 'CL=F', price: 70 },
          { symbol: 'NG=F', price: 3 },
        ],
      },
    };
    const focused = {
      _seed: { fetchedAt: NOW_MS, recordCount: 3, state: 'PARTIAL' },
      data: {
        quotes: [
          { symbol: 'GC=F', price: 999 },
          { symbol: '^VIX', price: 16 },
          { symbol: 'BZ=F', price: 74 },
        ],
      },
    };

    const projection = resolveTopmanCoreProjection(
      'commodityQuotes',
      canonical,
      focused,
      NOW_MS,
    );
    assert.equal(projection.quotes.find((quote) => quote.symbol === 'GC=F').price, 100);
    assert.equal(projection.quotes.length, 5);
  });

  it('rejects focused envelopes that are older than their dataset freshness gate', () => {
    const canonical = { alerts: [{ id: 'canonical' }] };
    const staleFocused = {
      _seed: {
        fetchedAt: NOW_MS - 46 * 60_000,
        recordCount: 1,
        state: 'OK',
      },
      data: { alerts: [{ id: 'focused-stale' }] },
    };

    assert.deepEqual(
      resolveTopmanCoreProjection('weatherAlerts', canonical, staleFocused, NOW_MS),
      canonical,
    );
  });

  it('fails closed consistently for future timestamps and invalid publication states', async () => {
    const earthquake = TOPMAN_CORE_DATASETS.find((dataset) => dataset.id === 'earthquakes');
    const commodity = TOPMAN_CORE_DATASETS.find((dataset) => dataset.id === 'commodities');
    assert.ok(earthquake && commodity);

    const futureEarthquake = {
      _seed: {
        fetchedAt: NOW_MS + 24 * 60 * 60_000,
        recordCount: 1,
        state: 'OK',
      },
      data: healthyData('earthquakes'),
    };
    const failedCommodity = {
      _seed: {
        fetchedAt: NOW_MS - 60_000,
        recordCount: 7,
        state: 'FAILED',
      },
      data: healthyData('commodityQuotes'),
    };

    const canonicalEarthquakes = { earthquakes: [{ id: 'canonical' }] };
    assert.deepEqual(
      resolveTopmanCoreProjection(
        'earthquakes',
        canonicalEarthquakes,
        futureEarthquake,
        NOW_MS,
      ),
      canonicalEarthquakes,
    );

    const snapshot = await readTopmanCoreSnapshot({
      includeData: true,
      executePipeline: makePipeline({
        [earthquake.dataKey]: JSON.stringify(futureEarthquake),
        [commodity.dataKey]: JSON.stringify(failedCommodity),
      }),
      now: () => NOW_MS,
    });

    const statuses = Object.fromEntries(
      snapshot.datasets.map((dataset) => [dataset.id, dataset]),
    );
    assert.equal(snapshot.status, 'UNHEALTHY');
    assert.equal(statuses.earthquakes.state, 'MISSING');
    assert.equal(statuses.earthquakes.lastSuccessAt, null);
    assert.equal(statuses.earthquakes.ageSeconds, null);
    assert.equal(statuses.commodities.state, 'MISSING');
    assert.equal(statuses.commodities.lastSuccessAt, null);
    assert.equal(snapshot.summary.crit, 2);
    assert.equal('earthquakes' in snapshot.data, false);
    assert.equal('commodityQuotes' in snapshot.data, false);
    assert.deepEqual(
      snapshot.missing.sort(),
      ['commodityQuotes', 'earthquakes'],
    );
  });

  it('distinguishes partial coverage, failed last attempts, stale data, and missing data', async () => {
    const commodity = TOPMAN_CORE_DATASETS.find((dataset) => dataset.id === 'commodities');
    const gdelt = TOPMAN_CORE_DATASETS.find((dataset) => dataset.id === 'gdelt-intel');
    const earthquake = TOPMAN_CORE_DATASETS.find((dataset) => dataset.id === 'earthquakes');
    const weather = TOPMAN_CORE_DATASETS.find((dataset) => dataset.id === 'weather-alerts');
    assert.ok(commodity && gdelt && earthquake && weather);

    const partialData = { quotes: [{}, {}, {}] };
    const snapshot = await readTopmanCoreSnapshot({
      executePipeline: makePipeline({
        [commodity.dataKey]: JSON.stringify({
          _seed: {
            fetchedAt: NOW_MS - 60_000,
            recordCount: 3,
            sourceVersion: 'partial',
            schemaVersion: 1,
            state: 'PARTIAL',
          },
          data: partialData,
        }),
        [commodity.metaKey]: JSON.stringify({
          fetchedAt: NOW_MS - 60_000,
          recordCount: 3,
          sourceVersion: 'partial',
          coverage: 'partial',
        }),
        [gdelt.attemptKey]: JSON.stringify({
          attemptedAt: NOW_MS - 30_000,
          status: 'FAILED',
          durationMs: 18_000,
          errorCategory: 'RATE_LIMITED',
        }),
        [earthquake.metaKey]: JSON.stringify({
          fetchedAt: NOW_MS - 2 * 60 * 60_000,
          recordCount: 1,
          sourceVersion: 'stale',
          coverage: 'focused',
        }),
        [earthquake.dataKey]: JSON.stringify({
          _seed: {
            fetchedAt: NOW_MS - 2 * 60 * 60_000,
            recordCount: 1,
            sourceVersion: 'stale',
            schemaVersion: 1,
            state: 'OK',
          },
          data: healthyData('earthquakes'),
        }),
        [weather.dataKey]: null,
      }),
      now: () => NOW_MS,
    });

    const states = Object.fromEntries(snapshot.datasets.map((dataset) => [dataset.id, dataset.state]));
    assert.equal(states.commodities, 'PARTIAL');
    assert.equal(states['gdelt-intel'], 'FAILED_USING_LAST_GOOD');
    assert.equal(states.earthquakes, 'STALE');
    assert.equal(states['weather-alerts'], 'MISSING');
    assert.equal(snapshot.status, 'UNHEALTHY');
    assert.deepEqual(snapshot.summary, {
      total: 6,
      ok: 2,
      warn: 3,
      onDemandWarn: 0,
      staleContent: 1,
      crit: 1,
    });
  });

  it('marks frozen FX content stale even when the refresh envelope is recent', async () => {
    const fx = TOPMAN_CORE_DATASETS.find((dataset) => dataset.id === 'fx-rates');
    assert.ok(fx);
    const frozenFx = healthyData('ecbFxRates');
    frozenFx.updatedAt = '2026-07-18';

    const snapshot = await readTopmanCoreSnapshot({
      executePipeline: makePipeline({
        [fx.dataKey]: JSON.stringify({
          _seed: {
            fetchedAt: NOW_MS - 60_000,
            recordCount: 10,
            sourceVersion: 'frozen-fx',
            schemaVersion: 3,
            state: 'OK',
          },
          data: frozenFx,
        }),
      }),
      now: () => NOW_MS,
    });

    const fxStatus = snapshot.datasets.find((dataset) => dataset.id === 'fx-rates');
    assert.equal(fxStatus.state, 'STALE');
    assert.ok(fxStatus.contentAgeSeconds > 10 * 24 * 60 * 60);
    assert.equal(snapshot.status, 'WARNING');
  });

  it('maps usable Core 6 snapshot data into the daily-brief bag', async () => {
    const core = await loadTopmanCoreForBrief({
      executePipeline: makePipeline(),
      now: () => NOW_MS,
    });
    assert.ok(core);
    assert.deepEqual(Object.keys(core).sort(), [
      'commodities',
      'earthquakes',
      'fxRates',
      'gdeltIntel',
      'naturalEvents',
      'weatherAlerts',
    ]);
    assert.ok(Array.isArray(core.earthquakes.earthquakes));
    assert.ok(Array.isArray(core.commodities.quotes));
    assert.ok(Array.isArray(core.fxRates.rates));
  });

  it('fails closed when any Redis command is malformed', async () => {
    await assert.rejects(
      readTopmanCoreSnapshot({
        executePipeline: async (commands) => commands.map((_, index) =>
          index === 2 ? { error: 'redis failed' } : { result: null }),
        now: () => NOW_MS,
      }),
      /Redis command failed/,
    );
  });
});
