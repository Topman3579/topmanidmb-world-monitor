import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  type PublishableDataset,
  assertUpstreamArrayPayload,
  classifyRefreshError,
  countUniqueGdeltTopicArticles,
  fetchCommodityQuotes,
  isAuthorizedCronRequest,
  normalizeEarthquakes,
  normalizeEcbFxSeries,
  normalizeGdeltArticles,
  normalizeNaturalEvents,
  normalizeWeatherAlerts,
  normalizeYahooQuote,
  publishDatasets,
  recordRefreshAttempts,
} from '../api/topman-core-refresh.ts';
import handler from '../api/topman-core-refresh.ts';

function datasetFixture(name: string): PublishableDataset {
  return {
    name,
    key: `topman:core:data:${name}:v1`,
    metaKey: `topman:core:meta:${name}:v1`,
    ttlSeconds: 300,
    sourceVersion: 'test-v1',
    schemaVersion: 1,
    data: { rows: [{ id: name }] },
    recordCount: 1,
  };
}

function responseJson(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('TOPMAN core refresh authorization', () => {
  it('fails closed without a configured secret and accepts only an exact GET bearer token', () => {
    const request = new Request('https://example.test/api/topman-core-refresh?group=fast', {
      headers: { Authorization: 'Bearer test-secret' },
    });
    assert.equal(isAuthorizedCronRequest(request, undefined), false);
    assert.equal(isAuthorizedCronRequest(request, 'wrong-secret'), false);
    assert.equal(isAuthorizedCronRequest(request, 'test-secret'), true);
    assert.equal(isAuthorizedCronRequest(new Request(request.url, {
      method: 'POST',
      headers: request.headers,
    }), 'test-secret'), false);
  });

  it('registers the three authenticated refresh groups as Vercel Pro crons', () => {
    const vercelConfig = JSON.parse(readFileSync(
      fileURLToPath(new URL('../vercel.json', import.meta.url)),
      'utf8',
    )) as { crons?: Array<{ path: string; schedule: string }> };
    assert.deepEqual(vercelConfig.crons, [
      { path: '/api/topman-core-refresh?group=fast', schedule: '*/15 * * * *' },
      { path: '/api/topman-core-refresh?group=market', schedule: '3,23,43 * * * *' },
      { path: '/api/topman-core-refresh?group=slow', schedule: '7 */3 * * *' },
    ]);
  });
});

describe('TOPMAN core Redis publication', () => {
  it('publishes data, metadata, and generations atomically only under the TOPMAN namespace', async () => {
    const datasets = [datasetFixture('earthquakes'), datasetFixture('weather-alerts')];
    const captured: string[][][] = [];
    const published = await publishDatasets(datasets, 1_700_000_000_000, async (commands) => {
      captured.push(commands);
      return [{ result: datasets.length }];
    });

    assert.equal(published, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.length, 1);
    const command = captured[0]?.[0] ?? [];
    assert.equal(command[0], 'EVAL');
    const keyCount = Number(command[2]);
    assert.equal(keyCount, datasets.length * 3);
    const keys = command.slice(3, 3 + keyCount);
    assert.equal(keys.every((key) => key.startsWith('topman:core:')), true);
    assert.equal(keys.some((key) => key.startsWith('seed-meta:')), false);
    assert.equal(JSON.stringify(command).includes('health:verdict'), false);
  });

  it('fails closed on malformed, errored, or incomplete pipeline results', async () => {
    const oneDataset = [datasetFixture('earthquakes')];
    const twoDatasets = [...oneDataset, datasetFixture('weather-alerts')];

    assert.equal(await publishDatasets(oneDataset, 1, async () => null), false);
    assert.equal(await publishDatasets(oneDataset, 1, async () => []), false);
    assert.equal(await publishDatasets(oneDataset, 1, async () => [{}]), false);
    assert.equal(await publishDatasets(oneDataset, 1, async () => [{ result: 'OK' }]), false);
    assert.equal(await publishDatasets(oneDataset, 1, async () => [{ result: 1, error: 'write failed' }]), false);
    assert.equal(await publishDatasets(oneDataset, 1, async () => [{ result: 1 }, { result: 1 }]), false);
    assert.equal(await publishDatasets(twoDatasets, 1, async () => [{ result: 1 }]), false);
    assert.equal(await publishDatasets(twoDatasets, 1, async () => [{ result: 2 }]), true);
  });

  it('rejects non-TOPMAN keys before invoking Redis', async () => {
    let redisCalls = 0;
    const canonicalDataset = {
      ...datasetFixture('earthquakes'),
      key: 'seismology:earthquakes:v1',
      metaKey: 'seed-meta:seismology:earthquakes',
    };

    const published = await publishDatasets([canonicalDataset], 1, async () => {
      redisCalls += 1;
      return [{ result: 1 }];
    });

    assert.equal(published, false);
    assert.equal(redisCalls, 0);
  });

  it('records bounded attempt metadata only under the TOPMAN namespace', async () => {
    const captured: string[][][] = [];
    const recorded = await recordRefreshAttempts([
      {
        name: 'gdelt-intel',
        attemptedAt: 1_700_000_000_000,
        status: 'FAILED',
        durationMs: 18_250,
        errorCategory: 'RATE_LIMITED',
      },
    ], async (commands) => {
      captured.push(commands);
      return commands.map(() => ({ result: 'OK' }));
    });

    assert.equal(recorded, true);
    assert.equal(captured[0]?.[0]?.[0], 'SET');
    assert.equal(captured[0]?.[0]?.[1], 'topman:core:attempt:gdelt-intel:v1');
    assert.doesNotMatch(JSON.stringify(captured), /seed-meta:|health:verdict/);
  });

  it('returns PUBLISH_FAILED when Redis returns a malformed publish result and releases its own lock', async () => {
    const previousFetch = globalThis.fetch;
    const previousSecret = process.env.CRON_SECRET;
    const previousRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const previousRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const redisCommands: string[][][] = [];
    let redisCall = 0;

    process.env.CRON_SECRET = 'test-secret';
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    globalThis.fetch = (async (input, init) => {
      const url = requestUrl(input);
      if (url.startsWith('https://redis.test/')) {
        assert.equal(typeof init?.body, 'string');
        const commands = JSON.parse(init?.body as string) as string[][];
        redisCommands.push(commands);
        redisCall += 1;
        if (redisCall === 1) return responseJson([{ result: 'OK' }]);
        if (redisCall === 2) return responseJson([{}]);
        if (redisCall === 3) return responseJson(commands.map(() => ({ result: 'OK' })));
        return responseJson([{ result: 1 }]);
      }
      if (url.includes('earthquake.usgs.gov')) {
        return responseJson({
          features: [{
            id: 'quake-1',
            properties: { place: 'Test Ridge', mag: 5.2, time: 1_700_000_000_000, url: 'https://example.test/q' },
            geometry: { coordinates: [100.5, 13.7, 12] },
          }],
        });
      }
      if (url.includes('api.weather.gov')) {
        return responseJson({
          features: [{
            id: 'alert-1',
            properties: { event: 'Storm', severity: 'Severe' },
            geometry: null,
          }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const response = await handler(new Request(
        'https://example.test/api/topman-core-refresh?group=fast',
        { headers: { Authorization: 'Bearer test-secret' } },
      ));
      const body = await response.json() as { status?: string };

      assert.equal(response.status, 503);
      assert.equal(body.status, 'PUBLISH_FAILED');
      assert.equal(redisCommands.length, 4);
      const publishCommand = redisCommands[1]?.[0] ?? [];
      assert.equal(publishCommand[0], 'EVAL');
      const keyCount = Number(publishCommand[2]);
      const keys = publishCommand.slice(3, 3 + keyCount);
      assert.equal(keys.every((key) => key.startsWith('topman:core:')), true);
      assert.equal(JSON.stringify(redisCommands).includes('health:verdict'), false);
      assert.equal(redisCommands[2]?.every((command) =>
        command[0] === 'SET' && command[1]?.startsWith('topman:core:attempt:')), true);
      assert.equal(redisCommands[3]?.[0]?.includes('topman:core:lock:fast:v1'), true);
    } finally {
      globalThis.fetch = previousFetch;
      restoreEnvironment('CRON_SECRET', previousSecret);
      restoreEnvironment('UPSTASH_REDIS_REST_URL', previousRedisUrl);
      restoreEnvironment('UPSTASH_REDIS_REST_TOKEN', previousRedisToken);
    }
  });

  it('fails closed before upstream fetches when the TOPMAN lock is already held', async () => {
    const previousFetch = globalThis.fetch;
    const previousSecret = process.env.CRON_SECRET;
    const previousRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const previousRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    let upstreamCalls = 0;

    process.env.CRON_SECRET = 'test-secret';
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    globalThis.fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.startsWith('https://redis.test/')) return responseJson([{ result: null }]);
      upstreamCalls += 1;
      throw new Error(`Unexpected upstream fetch: ${url}`);
    }) as typeof fetch;

    try {
      const response = await handler(new Request(
        'https://example.test/api/topman-core-refresh?group=slow',
        { headers: { Authorization: 'Bearer test-secret' } },
      ));
      const body = await response.json() as { status?: string };

      assert.equal(response.status, 409);
      assert.equal(body.status, 'LOCKED');
      assert.equal(upstreamCalls, 0);
    } finally {
      globalThis.fetch = previousFetch;
      restoreEnvironment('CRON_SECRET', previousSecret);
      restoreEnvironment('UPSTASH_REDIS_REST_URL', previousRedisUrl);
      restoreEnvironment('UPSTASH_REDIS_REST_TOKEN', previousRedisToken);
    }
  });
});

describe('TOPMAN core refresh normalizers', () => {
  it('normalizes USGS features and rejects entries without usable coordinates', () => {
    const rows = normalizeEarthquakes({
      features: [
        {
          id: 'quake-1',
          properties: {
            place: 'Test Ridge',
            mag: 5.2,
            time: 1_700_000_000_000,
            url: 'https://earthquake.usgs.gov/example',
          },
          geometry: { coordinates: [100.5, 13.7, 12] },
        },
        { id: 'bad', properties: { mag: 7 }, geometry: { coordinates: [] } },
      ],
    });

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.location, { latitude: 13.7, longitude: 100.5 });
    assert.equal(rows[0]?.magnitude, 5.2);
  });

  it('normalizes active weather polygons and omits unknown-severity alerts', () => {
    const rows = normalizeWeatherAlerts({
      features: [
        {
          id: 'alert-1',
          properties: {
            event: 'Storm',
            severity: 'Severe',
            headline: 'Storm warning',
            description: 'Details',
            areaDesc: 'Bangkok',
            onset: '2026-07-30T00:00:00Z',
            expires: '2026-07-30T03:00:00Z',
          },
          geometry: { type: 'Polygon', coordinates: [[[100, 13], [102, 15]]] },
        },
        { properties: { severity: 'Unknown' } },
      ],
    });

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.centroid, [101, 14]);
  });

  it('accepts valid empty observations but rejects malformed empty-object contracts', () => {
    assert.doesNotThrow(() => assertUpstreamArrayPayload({ features: [] }, 'features', 'NWS'));
    assert.doesNotThrow(() => assertUpstreamArrayPayload({ events: [] }, 'events', 'NASA EONET'));
    assert.throws(
      () => assertUpstreamArrayPayload({}, 'features', 'NWS'),
      /invalid features contract/,
    );
    try {
      assertUpstreamArrayPayload({}, 'events', 'NASA EONET');
      assert.fail('malformed EONET payload must be rejected');
    } catch (error) {
      assert.equal(classifyRefreshError(error), 'INVALID_PAYLOAD');
    }
  });

  it('normalizes only point-based EONET events', () => {
    const rows = normalizeNaturalEvents({
      events: [
        {
          id: 'event-1',
          title: 'Typhoon Test',
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
          geometry: [{
            type: 'Point',
            coordinates: [120, 15],
            date: '2026-07-30T00:00:00Z',
          }],
          sources: [{ id: 'NASA', url: 'https://eonet.gsfc.nasa.gov/' }],
          closed: null,
        },
        {
          id: 'old-wildfire',
          title: 'Old wildfire',
          categories: [{ id: 'wildfires', title: 'Wildfires' }],
          geometry: [{
            type: 'Point',
            coordinates: [101, 14],
            date: '2026-07-27T00:00:00Z',
          }],
        },
        {
          id: 'event-earthquake',
          title: 'Duplicate earthquake',
          categories: [{ id: 'earthquakes', title: 'Earthquakes' }],
          geometry: [{ type: 'Point', coordinates: [101, 14], date: '2026-07-30T00:00:00Z' }],
        },
        { id: 'event-2', geometry: [{ type: 'Polygon', coordinates: [] }] },
      ],
    }, Date.parse('2026-07-30T00:00:00Z'));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.category, 'severeStorms');
    assert.equal(rows[0]?.lat, 15);
    assert.equal(rows[0]?.lon, 120);
    assert.deepEqual(rows[0]?.forecastTrack, []);
    assert.deepEqual(rows[0]?.agencyObservations, []);
  });

  it('keeps only GDELT articles with safe HTTP URLs', () => {
    const rows = normalizeGdeltArticles({
      articles: [
        {
          title: 'ASEAN update',
          url: 'https://example.com/story',
          domain: 'example.com',
          seendate: '20260730T000000Z',
        },
        { title: 'Unsafe', url: 'javascript:alert(1)' },
      ],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.title, 'ASEAN update');
  });

  it('counts only unique GDELT articles actually emitted in topic projections', () => {
    assert.equal(countUniqueGdeltTopicArticles([
      {
        id: 'intelligence',
        articles: [
          { title: 'Story A', url: 'https://example.com/a' },
          { title: 'Story B', url: 'https://example.com/b' },
        ],
      },
      {
        id: 'military',
        articles: [
          { title: 'Story A duplicated', url: 'https://example.com/a' },
          { title: 'Story C' },
        ],
      },
    ]), 3);
  });

  it('maps Yahoo chart data into the dashboard quote contract', () => {
    const quote = normalizeYahooQuote({
      chart: {
        result: [{
          meta: { regularMarketPrice: 105, chartPreviousClose: 100 },
          indicators: { quote: [{ close: [100, null, 105] }] },
        }],
      },
    }, { symbol: 'CL=F', name: 'Crude Oil WTI', display: 'OIL' });

    assert.equal(quote?.price, 105);
    assert.equal(quote?.change, 5);
    assert.deepEqual(quote?.sparkline, [100, 105]);
  });

  it('computes real day-over-day ECB FX changes from provider-pinned observations', () => {
    const normalized = normalizeEcbFxSeries([
      { date: '2026-07-28', base: 'EUR', quote: 'USD', rate: 1.16 },
      { date: '2026-07-29', base: 'EUR', quote: 'USD', rate: 1.17 },
      { date: '2026-07-28', base: 'EUR', quote: 'JPY', rate: 171.2 },
      { date: '2026-07-29', base: 'EUR', quote: 'JPY', rate: 170.8 },
      { date: '2026-07-29', base: 'USD', quote: 'THB', rate: 32.1 },
    ]);

    assert.equal(normalized.updatedAt, '2026-07-29');
    assert.deepEqual(normalized.rates, [
      { pair: 'EURUSD', rate: 1.17, date: '2026-07-29', change1d: 0.01 },
      { pair: 'EURJPY', rate: 170.8, date: '2026-07-29', change1d: -0.4 },
    ]);
  });

  it('stages Yahoo request starts at least 200 ms apart while preserving partial success', async () => {
    const delays: number[] = [];
    const quotes = await fetchCommodityQuotes(
      async () => ({
        chart: {
          result: [{
            meta: { regularMarketPrice: 105, chartPreviousClose: 100 },
            indicators: { quote: [{ close: [100, 105] }] },
          }],
        },
      }),
      async (ms) => { delays.push(ms); },
    );

    assert.equal(quotes.length, 7);
    assert.deepEqual(delays, [200, 400, 600, 800, 1000, 1200]);
    assert.equal(delays.every((ms, index) => index === 0 || ms - delays[index - 1]! >= 200), true);
  });

  it('classifies upstream failures without exposing raw error text in metadata', () => {
    assert.equal(classifyRefreshError(new DOMException('timed out', 'TimeoutError')), 'TIMEOUT');
    assert.equal(classifyRefreshError(new Error('returned no usable rows')), 'INVALID_PAYLOAD');
    assert.equal(classifyRefreshError(new Error('socket reset')), 'UPSTREAM_ERROR');
  });
});
