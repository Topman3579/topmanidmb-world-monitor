// TOPMANIDMB public-data refresh lane.
//
// This endpoint is called only by authenticated Vercel Cron requests. It keeps
// a deliberately small set of decision-support datasets warm for the TOPMAN
// command center without pretending that every upstream World Monitor producer
// is enabled in this fork.

// @ts-expect-error -- shared JavaScript helper is edge-safe and covered by API tests.
import { jsonResponse } from './_json-response.js';
// @ts-expect-error -- shared JavaScript helper is edge-safe and covered by API tests.
import { buildEnvelope } from './_seed-envelope.js';
// @ts-expect-error -- shared JavaScript helper is edge-safe and covered by API tests.
import { redisPipeline } from './_upstash-json.js';

export const config = { runtime: 'edge' };

type RefreshGroup = 'fast' | 'slow' | 'market';

export interface PublishableDataset {
  name: string;
  key: string;
  metaKey: string;
  ttlSeconds: number;
  sourceVersion: string;
  schemaVersion: number;
  data: unknown;
  recordCount: number;
}

type RedisPipelineEntry = {
  result?: unknown;
  error?: unknown;
};

type RedisPipelineExecutor = (
  commands: string[][],
  timeoutMs?: number,
) => Promise<Array<RedisPipelineEntry> | null>;

interface RefreshResult {
  name: string;
  status: 'published' | 'failed';
  recordCount?: number;
  reason?: string;
}

const GROUPS = new Set<RefreshGroup>(['fast', 'slow', 'market']);
const FETCH_TIMEOUT_MS = 12_000;
const META_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOCK_TTL_SECONDS = 90;
const TOPMAN_CORE_PREFIX = 'topman:core';
const USER_AGENT = 'topmanidmb-world-monitor/2.0 (+https://topmanidmb-world-monitor.vercel.app)';

const ATOMIC_PUBLISH_SCRIPT = `
#!lua flags=allow-key-locking

local datasetCount = tonumber(ARGV[1])
local fetchedAt = tonumber(ARGV[2])
if not datasetCount or not fetchedAt or datasetCount < 1 then
  return redis.error_reply('invalid publish arguments')
end

for index = 1, datasetCount do
  local keyOffset = ((index - 1) * 3)
  local generationKey = KEYS[keyOffset + 3]
  local previousFetchedAt = tonumber(redis.call('GET', generationKey) or '0')
  if previousFetchedAt > fetchedAt then
    return -index
  end
end

for index = 1, datasetCount do
  local keyOffset = ((index - 1) * 3)
  local argumentOffset = 3 + ((index - 1) * 4)
  local dataKey = KEYS[keyOffset + 1]
  local metaKey = KEYS[keyOffset + 2]
  local generationKey = KEYS[keyOffset + 3]
  local dataJson = ARGV[argumentOffset]
  local metaJson = ARGV[argumentOffset + 1]
  local dataTtl = ARGV[argumentOffset + 2]
  local metaTtl = ARGV[argumentOffset + 3]

  redis.call('SET', dataKey, dataJson, 'EX', dataTtl)
  redis.call('SET', metaKey, metaJson, 'EX', metaTtl)
  redis.call('SET', generationKey, tostring(fetchedAt), 'EX', metaTtl)
end

return datasetCount
`.trim();

const RELEASE_LOCK_SCRIPT = `
#!lua flags=allow-key-locking

if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`.trim();

const CATEGORY_MAP: Record<string, string> = {
  severeStorms: 'severeStorms',
  wildfires: 'wildfires',
  volcanoes: 'volcanoes',
  earthquakes: 'earthquakes',
  floods: 'floods',
  landslides: 'landslides',
  drought: 'drought',
  dustHaze: 'dustHaze',
  snow: 'snow',
  tempExtremes: 'tempExtremes',
  seaLakeIce: 'seaLakeIce',
  waterColor: 'waterColor',
};

const COMMODITIES = [
  { symbol: '^VIX', name: 'VIX', display: 'VIX' },
  { symbol: 'GC=F', name: 'Gold', display: 'GOLD' },
  { symbol: 'SI=F', name: 'Silver', display: 'SILVER' },
  { symbol: 'HG=F', name: 'Copper', display: 'COPPER' },
  { symbol: 'CL=F', name: 'Crude Oil WTI', display: 'OIL' },
  { symbol: 'BZ=F', name: 'Brent Crude', display: 'BRENT' },
  { symbol: 'NG=F', name: 'Natural Gas', display: 'NATGAS' },
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

async function fetchJson(url: string, label: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return response.json();
}

export function isAuthorizedCronRequest(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret || request.method !== 'GET') return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export function normalizeEarthquakes(raw: unknown): Array<Record<string, unknown>> {
  const root = asRecord(raw);
  return asArray(root?.features).flatMap((feature) => {
    const item = asRecord(feature);
    const properties = asRecord(item?.properties);
    const geometry = asRecord(item?.geometry);
    const coordinates = asArray(geometry?.coordinates);
    const longitude = asFiniteNumber(coordinates[0], Number.NaN);
    const latitude = asFiniteNumber(coordinates[1], Number.NaN);
    if (!properties || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    return [{
      id: asString(item?.id),
      place: asString(properties.place),
      magnitude: asFiniteNumber(properties.mag),
      depthKm: asFiniteNumber(coordinates[2]),
      location: { latitude, longitude },
      occurredAt: asFiniteNumber(properties.time),
      sourceUrl: isHttpUrl(properties.url) ? properties.url : '',
    }];
  });
}

export function normalizeWeatherAlerts(raw: unknown): Array<Record<string, unknown>> {
  const root = asRecord(raw);
  return asArray(root?.features).flatMap((feature) => {
    const item = asRecord(feature);
    const properties = asRecord(item?.properties);
    if (!properties || asString(properties.severity) === 'Unknown') return [];

    const geometry = asRecord(item?.geometry);
    const rawCoordinates = geometry?.type === 'Polygon'
      ? asArray(asArray(geometry.coordinates)[0])
      : geometry?.type === 'MultiPolygon'
        ? asArray(asArray(asArray(geometry.coordinates)[0])[0])
        : [];
    const coordinates: Array<[number, number]> = rawCoordinates.flatMap((point) => {
      const pair = asArray(point);
      const longitude = asFiniteNumber(pair[0], Number.NaN);
      const latitude = asFiniteNumber(pair[1], Number.NaN);
      return Number.isFinite(longitude) && Number.isFinite(latitude)
        ? [[longitude, latitude] as [number, number]]
        : [];
    });
    const centroid: [number, number] | undefined = coordinates.length > 0
      ? coordinates.reduce(
        (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as [number, number],
        [0, 0] as [number, number],
      ).map((sum) => sum / coordinates.length) as [number, number]
      : undefined;

    return [{
      id: asString(item?.id),
      event: asString(properties.event),
      severity: asString(properties.severity),
      headline: asString(properties.headline),
      description: asString(properties.description).slice(0, 500),
      areaDesc: asString(properties.areaDesc),
      onset: asString(properties.onset),
      expires: asString(properties.expires),
      coordinates,
      ...(centroid ? { centroid } : {}),
    }];
  }).slice(0, 80);
}

export function normalizeNaturalEvents(raw: unknown): Array<Record<string, unknown>> {
  const root = asRecord(raw);
  return asArray(root?.events).flatMap((event) => {
    const item = asRecord(event);
    const categories = asArray(item?.categories);
    const category = asRecord(categories[0]);
    const geometryEntries = asArray(item?.geometry);
    const geometry = asRecord(geometryEntries[geometryEntries.length - 1]);
    const coordinates = asArray(geometry?.coordinates);
    const longitude = asFiniteNumber(coordinates[0], Number.NaN);
    const latitude = asFiniteNumber(coordinates[1], Number.NaN);
    if (!item || geometry?.type !== 'Point' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return [];
    }
    const rawCategory = asString(category?.id);
    const sources = asArray(item.sources);
    const source = asRecord(sources[0]);

    return [{
      id: asString(item.id),
      title: asString(item.title),
      description: asString(item.description),
      category: CATEGORY_MAP[rawCategory] ?? 'manmade',
      categoryTitle: asString(category?.title),
      lat: latitude,
      lon: longitude,
      date: Date.parse(asString(geometry.date)) || 0,
      magnitude: asFiniteNumber(geometry.magnitudeValue),
      magnitudeUnit: asString(geometry.magnitudeUnit),
      sourceUrl: isHttpUrl(source?.url) ? source.url : '',
      sourceName: asString(source?.id),
      closed: item.closed != null,
    }];
  });
}

export function normalizeGdeltArticles(raw: unknown): Array<Record<string, unknown>> {
  const root = asRecord(raw);
  return asArray(root?.articles).flatMap((article) => {
    const item = asRecord(article);
    if (!item || !isHttpUrl(item.url) || !asString(item.title)) return [];
    return [{
      title: asString(item.title).slice(0, 500),
      url: item.url,
      source: asString(item.domain),
      date: asString(item.seendate),
      image: isHttpUrl(item.socialimage) ? item.socialimage : '',
      language: asString(item.language),
      tone: asFiniteNumber(item.tone),
    }];
  });
}

export function normalizeYahooQuote(
  raw: unknown,
  metadata: { symbol: string; name: string; display: string },
): Record<string, unknown> | null {
  const root = asRecord(raw);
  const chart = asRecord(root?.chart);
  const result = asRecord(asArray(chart?.result)[0]);
  const meta = asRecord(result?.meta);
  const price = asFiniteNumber(meta?.regularMarketPrice, Number.NaN);
  if (!meta || !Number.isFinite(price)) return null;
  const previous = asFiniteNumber(meta.chartPreviousClose ?? meta.previousClose, price);
  const indicators = asRecord(result?.indicators);
  const quote = asRecord(asArray(indicators?.quote)[0]);
  const sparkline = asArray(quote?.close)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .map((value) => Number(value.toPrecision(7)));

  return {
    ...metadata,
    price,
    change: previous ? Number((((price - previous) / previous) * 100).toFixed(2)) : 0,
    sparkline,
  };
}

async function earthquakeDataset(): Promise<PublishableDataset> {
  const raw = await fetchJson(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
    'USGS',
  );
  const earthquakes = normalizeEarthquakes(raw);
  if (earthquakes.length === 0) throw new Error('USGS returned no usable earthquakes');
  return {
    name: 'earthquakes',
    key: `${TOPMAN_CORE_PREFIX}:data:earthquakes:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:earthquakes:v1`,
    ttlSeconds: 6 * 60 * 60,
    sourceVersion: 'topman-usgs-4.5-week-v1',
    schemaVersion: 1,
    data: { earthquakes },
    recordCount: earthquakes.length,
  };
}

async function weatherDataset(): Promise<PublishableDataset> {
  const raw = await fetchJson('https://api.weather.gov/alerts/active', 'NWS');
  const alerts = normalizeWeatherAlerts(raw);
  if (alerts.length === 0) throw new Error('NWS returned no usable active alerts');
  return {
    name: 'weather',
    key: `${TOPMAN_CORE_PREFIX}:data:weather-alerts:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:weather-alerts:v1`,
    ttlSeconds: 45 * 60,
    sourceVersion: 'topman-nws-active-v1',
    schemaVersion: 1,
    data: { alerts },
    recordCount: alerts.length,
  };
}

async function naturalDataset(): Promise<PublishableDataset> {
  const raw = await fetchJson(
    'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30',
    'NASA EONET',
  );
  const events = normalizeNaturalEvents(raw);
  if (events.length === 0) throw new Error('NASA EONET returned no usable events');
  return {
    name: 'natural-events',
    key: `${TOPMAN_CORE_PREFIX}:data:natural-events:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:natural-events:v1`,
    ttlSeconds: 18 * 60 * 60,
    sourceVersion: 'topman-eonet-v3',
    schemaVersion: 1,
    data: { events, fetchedAt: Date.now(), dataAvailable: true },
    recordCount: events.length,
  };
}

async function gdeltDataset(): Promise<PublishableDataset> {
  const query = encodeURIComponent(
    '(Thailand OR ASEAN OR Myanmar OR Cambodia OR "South China Sea" OR conflict OR military OR typhoon) sourcelang:eng',
  );
  const raw = await fetchJson(
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=50&format=json&sort=date&timespan=24h`,
    'GDELT',
  );
  const articles = normalizeGdeltArticles(raw);
  if (articles.length === 0) throw new Error('GDELT returned no usable articles');
  const fetchedAt = new Date().toISOString();
  const militaryTerms = /\b(military|army|navy|airstrike|missile|troop|warship|conflict|war)\b/i;
  const maritimeTerms = /\b(sea|naval|ship|maritime|strait|port|coast)\b/i;
  const military = articles.filter((article) => militaryTerms.test(asString(article.title)));
  const maritime = articles.filter((article) => maritimeTerms.test(asString(article.title)));
  const topics = [
    { id: 'military', articles: military.length > 0 ? military.slice(0, 15) : articles.slice(0, 10), fetchedAt },
    { id: 'intelligence', articles: articles.slice(0, 20), fetchedAt },
    { id: 'maritime', articles: maritime.length > 0 ? maritime.slice(0, 15) : articles.slice(0, 10), fetchedAt },
  ];
  return {
    name: 'gdelt-intel',
    key: `${TOPMAN_CORE_PREFIX}:data:gdelt-intel:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:gdelt-intel:v1`,
    ttlSeconds: 24 * 60 * 60,
    sourceVersion: 'topman-gdelt-asean-v1',
    schemaVersion: 1,
    data: { topics, fetchedAt },
    recordCount: topics.length,
  };
}

async function commoditiesDataset(): Promise<PublishableDataset> {
  const settled = await Promise.allSettled(COMMODITIES.map(async (metadata) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(metadata.symbol)}?range=5d&interval=1h`;
    return normalizeYahooQuote(await fetchJson(url, `Yahoo ${metadata.symbol}`), metadata);
  }));
  const quotes = settled.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []);
  if (quotes.length < 3) throw new Error(`Yahoo returned only ${quotes.length} usable commodity quotes`);
  return {
    name: 'commodities',
    key: `${TOPMAN_CORE_PREFIX}:data:commodities:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:commodities:v1`,
    ttlSeconds: 45 * 60,
    sourceVersion: 'topman-yahoo-chart-v1',
    schemaVersion: 1,
    data: { quotes },
    recordCount: quotes.length,
  };
}

async function fxDataset(): Promise<PublishableDataset> {
  const raw = asRecord(await fetchJson('https://api.frankfurter.app/latest?from=USD', 'Frankfurter FX'));
  const sourceRates = asRecord(raw?.rates);
  const rates = Object.fromEntries(
    Object.entries(sourceRates ?? {})
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0)
      .map(([currency, value]) => [currency, 1 / (value as number)]),
  );
  rates.USD = 1;
  if (Object.keys(rates).length < 10) throw new Error('Frankfurter returned insufficient FX coverage');
  return {
    name: 'fx-rates',
    key: `${TOPMAN_CORE_PREFIX}:data:fx-rates:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:fx-rates:v1`,
    ttlSeconds: 25 * 60 * 60,
    sourceVersion: 'topman-frankfurter-ecb-v1',
    schemaVersion: 1,
    data: rates,
    recordCount: Object.keys(rates).length,
  };
}

function datasetFactories(
  group: RefreshGroup,
): Array<{ name: string; run: () => Promise<PublishableDataset> }> {
  if (group === 'fast') {
    return [
      { name: 'earthquakes', run: earthquakeDataset },
      { name: 'weather', run: weatherDataset },
    ];
  }
  if (group === 'slow') {
    return [
      { name: 'natural-events', run: naturalDataset },
      { name: 'gdelt-intel', run: gdeltDataset },
    ];
  }
  return [
    { name: 'commodities', run: commoditiesDataset },
    { name: 'fx-rates', run: fxDataset },
  ];
}

function generationKey(dataset: PublishableDataset): string {
  return `${TOPMAN_CORE_PREFIX}:generation:${dataset.name}:v1`;
}

function isValidTopmanDataset(dataset: PublishableDataset): boolean {
  return /^[a-z0-9-]+$/.test(dataset.name)
    && dataset.key.startsWith(`${TOPMAN_CORE_PREFIX}:data:`)
    && dataset.metaKey.startsWith(`${TOPMAN_CORE_PREFIX}:meta:`)
    && Number.isInteger(dataset.ttlSeconds)
    && dataset.ttlSeconds > 0
    && Number.isInteger(dataset.schemaVersion)
    && dataset.schemaVersion > 0
    && Number.isInteger(dataset.recordCount)
    && dataset.recordCount >= 0;
}

function refreshLockKey(group: RefreshGroup): string {
  return `${TOPMAN_CORE_PREFIX}:lock:${group}:v1`;
}

function validSinglePipelineResult(
  response: Array<RedisPipelineEntry> | null,
  expected: unknown,
): boolean {
  if (!Array.isArray(response) || response.length !== 1) return false;
  const entry = asRecord(response[0]);
  return entry?.error == null && entry?.result === expected;
}

export async function publishDatasets(
  datasets: PublishableDataset[],
  fetchedAt: number,
  executePipeline: RedisPipelineExecutor = redisPipeline,
): Promise<boolean> {
  if (
    datasets.length === 0
    || datasets.some((dataset) => !isValidTopmanDataset(dataset))
    || !Number.isSafeInteger(fetchedAt)
    || fetchedAt <= 0
  ) {
    return false;
  }

  const keys: string[] = [];
  const args: string[] = [String(datasets.length), String(fetchedAt)];
  for (const dataset of datasets) {
    const metaTtlSeconds = Math.max(META_TTL_SECONDS, dataset.ttlSeconds);
    keys.push(
      dataset.key,
      dataset.metaKey,
      generationKey(dataset),
    );
    args.push(
      JSON.stringify(buildEnvelope({
        fetchedAt,
        recordCount: dataset.recordCount,
        sourceVersion: dataset.sourceVersion,
        schemaVersion: dataset.schemaVersion,
        state: 'OK',
        data: dataset.data,
      })),
      JSON.stringify({
        fetchedAt,
        recordCount: dataset.recordCount,
        sourceVersion: dataset.sourceVersion,
        scope: 'topman-core',
        coverage: 'focused',
      }),
      String(dataset.ttlSeconds),
      String(metaTtlSeconds),
    );
  }

  const command = ['EVAL', ATOMIC_PUBLISH_SCRIPT, String(keys.length), ...keys, ...args];
  const response = await executePipeline([command], 10_000);
  return validSinglePipelineResult(response, datasets.length);
}

type LockAcquisition = 'acquired' | 'held' | 'failed';

async function acquireRefreshLock(
  group: RefreshGroup,
  token: string,
  executePipeline: RedisPipelineExecutor = redisPipeline,
): Promise<LockAcquisition> {
  const response = await executePipeline([
    ['SET', refreshLockKey(group), token, 'NX', 'EX', String(LOCK_TTL_SECONDS)],
  ], 5_000);
  if (!Array.isArray(response) || response.length !== 1) return 'failed';
  const entry = asRecord(response[0]);
  if (entry?.error != null) return 'failed';
  if (entry?.result === 'OK') return 'acquired';
  return entry?.result === null ? 'held' : 'failed';
}

async function releaseRefreshLock(
  group: RefreshGroup,
  token: string,
  executePipeline: RedisPipelineExecutor = redisPipeline,
): Promise<boolean> {
  const response = await executePipeline([
    ['EVAL', RELEASE_LOCK_SCRIPT, '1', refreshLockKey(group), token],
  ], 5_000);
  return validSinglePipelineResult(response, 1)
    || validSinglePipelineResult(response, 0);
}

export default async function handler(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return jsonResponse({ ok: false, status: 'NOT_CONFIGURED' }, 503, {
      'Cache-Control': 'no-store',
    });
  }
  if (!isAuthorizedCronRequest(request)) {
    return jsonResponse({ ok: false, status: 'UNAUTHORIZED' }, 401, {
      'Cache-Control': 'no-store',
    });
  }

  const requestedGroup = new URL(request.url).searchParams.get('group');
  if (!requestedGroup || !GROUPS.has(requestedGroup as RefreshGroup)) {
    return jsonResponse({ ok: false, status: 'INVALID_GROUP' }, 400, {
      'Cache-Control': 'no-store',
    });
  }
  const group = requestedGroup as RefreshGroup;
  const lockToken = crypto.randomUUID();
  const lock = await acquireRefreshLock(group, lockToken);
  if (lock !== 'acquired') {
    return jsonResponse({
      ok: false,
      status: lock === 'held' ? 'LOCKED' : 'LOCK_FAILED',
      group,
    }, lock === 'held' ? 409 : 503, { 'Cache-Control': 'no-store' });
  }

  try {
    const factories = datasetFactories(group);
    const settled = await Promise.allSettled(factories.map((factory) => factory.run()));
    const datasets: PublishableDataset[] = [];
    const results: RefreshResult[] = settled.map((result, index) => {
      if (result.status === 'fulfilled') {
        datasets.push(result.value);
        return {
          name: result.value.name,
          status: 'published',
          recordCount: result.value.recordCount,
        };
      }
      return {
        name: factories[index]?.name ?? `${group}-${index + 1}`,
        status: 'failed',
        reason: errorMessage(result.reason).slice(0, 180),
      };
    });

    if (datasets.length > 0 && !await publishDatasets(datasets, Date.now())) {
      return jsonResponse({
        ok: false,
        status: 'PUBLISH_FAILED',
        group,
        results: results.map((result) => result.status === 'published'
          ? { ...result, status: 'failed', reason: 'Redis publish failed' }
          : result),
      }, 503, { 'Cache-Control': 'no-store' });
    }

    const failed = results.filter((result) => result.status === 'failed');
    return jsonResponse({
      ok: failed.length === 0,
      status: failed.length === 0 ? 'OK' : datasets.length > 0 ? 'PARTIAL' : 'FAILED',
      group,
      checkedAt: new Date().toISOString(),
      results,
    }, failed.length === 0 ? 200 : 503, {
      'Cache-Control': 'no-store',
    });
  } finally {
    await releaseRefreshLock(group, lockToken);
  }
}
