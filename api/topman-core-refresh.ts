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

// Node, not Edge: GDELT DOC API measured ~20s for the ASEAN query (rose,
// 23 Aug 2026) and Vercel Edge aborted it at 18s every slow cron after the
// last success. Edge maxDuration cannot cover a 35s fetch + Redis publish.
export const config = { runtime: 'nodejs', maxDuration: 60 };

type RefreshGroup = 'fast' | 'slow' | 'market';

export interface PublishableDataset {
  name: string;
  key: string;
  metaKey: string;
  ttlSeconds: number;
  sourceVersion: string;
  schemaVersion: number;
  state?: 'OK' | 'PARTIAL';
  coverage?: 'full' | 'focused' | 'partial';
  durationMs?: number;
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
  coverage?: 'full' | 'focused' | 'partial';
  durationMs?: number;
  errorCategory?: string;
  reason?: string;
}

interface RefreshAttempt {
  name: string;
  attemptedAt: number;
  status: 'OK' | 'PARTIAL' | 'FAILED';
  recordCount?: number;
  coverage?: 'full' | 'focused' | 'partial';
  durationMs: number;
  errorCategory?: string;
}

const GROUPS = new Set<RefreshGroup>(['fast', 'slow', 'market']);
const FETCH_TIMEOUT_MS = 12_000;
// Must exceed observed GDELT DOC latency (~20s). 18s AbortSignal was the
// production TIMEOUT loop: durationMs 17923 / 18483 on 00:07Z and 03:07Z.
export const GDELT_FETCH_TIMEOUT_MS = 35_000;
const META_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOCK_TTL_SECONDS = 90;
const TOPMAN_CORE_PREFIX = 'topman:core';
const YAHOO_STAGGER_MS = 200;
const WILDFIRE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const FX_MAX_CONTENT_AGE_MS = 10 * 24 * 60 * 60 * 1000;
const FX_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
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

class TopmanUpstreamError extends Error {
  readonly category: string;
  readonly retryAfterMs: number | null;

  constructor(message: string, category: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'TopmanUpstreamError';
    this.category = category;
    this.retryAfterMs = retryAfterMs;
  }
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

export function assertUpstreamArrayPayload(
  raw: unknown,
  field: string,
  label: string,
): void {
  const root = asRecord(raw);
  if (!root || !Array.isArray(root[field])) {
    throw new TopmanUpstreamError(
      `${label} returned an invalid ${field} contract`,
      'INVALID_PAYLOAD',
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export function classifyRefreshError(error: unknown): string {
  if (error instanceof TopmanUpstreamError) return error.category;
  const errorRecord = asRecord(error);
  if (errorRecord?.name === 'TimeoutError' || errorRecord?.name === 'AbortError') {
    return 'TIMEOUT';
  }
  const message = errorMessage(error).toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) return 'TIMEOUT';
  if (message.includes('json') || message.includes('usable') || message.includes('coverage')) {
    return 'INVALID_PAYLOAD';
  }
  return 'UPSTREAM_ERROR';
}

async function fetchJson(
  url: string,
  label: string,
  timeoutMs = FETCH_TIMEOUT_MS,
  retries = 0,
): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(attempt === 0 ? timeoutMs : Math.min(timeoutMs, 6_000)),
    });
    if (!response.ok) {
      const retryDelay = retryAfterMs(response);
      const category = response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_HTTP';
      if (
        attempt < retries
        && (response.status === 429 || response.status === 503)
        && (retryDelay === null || retryDelay <= 1_000)
      ) {
        await delay(retryDelay ?? 500);
        continue;
      }
      throw new TopmanUpstreamError(
        `${label} HTTP ${response.status}`,
        category,
        retryDelay,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new TopmanUpstreamError(`${label} returned invalid JSON`, 'INVALID_PAYLOAD');
    }
  }
  throw new TopmanUpstreamError(`${label} retries exhausted`, 'UPSTREAM_ERROR');
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

export function normalizeNaturalEvents(
  raw: unknown,
  nowMs = Date.now(),
): Array<Record<string, unknown>> {
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
    // Earthquakes already come from the higher-frequency USGS lane. Matching
    // the canonical EONET projection avoids duplicate map markers.
    if (rawCategory === 'earthquakes') return [];
    const eventDate = Date.parse(asString(geometry.date));
    if (
      rawCategory === 'wildfires'
      && (!Number.isFinite(eventDate) || nowMs - eventDate > WILDFIRE_MAX_AGE_MS)
    ) {
      return [];
    }
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
      date: eventDate || 0,
      magnitude: asFiniteNumber(geometry.magnitudeValue),
      magnitudeUnit: asString(geometry.magnitudeUnit),
      sourceUrl: isHttpUrl(source?.url) ? source.url : '',
      sourceName: asString(source?.id),
      closed: item.closed != null,
      forecastTrack: [],
      conePolygon: [],
      pastTrack: [],
      canonicalAliases: [],
      agencyObservations: [],
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

export function countUniqueGdeltTopicArticles(topics: unknown[]): number {
  const identities = new Set<string>();
  for (const topicValue of topics) {
    const topic = asRecord(topicValue);
    for (const articleValue of asArray(topic?.articles)) {
      const article = asRecord(articleValue);
      const identity = asString(article?.url) || asString(article?.title);
      if (identity) identities.add(identity);
    }
  }
  return identities.size;
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

export function normalizeEcbFxSeries(raw: unknown): {
  rates: Array<{ pair: string; rate: number; date: string; change1d: number }>;
  updatedAt: string;
} {
  const byQuote = new Map<string, Array<{ date: string; rate: number }>>();
  for (const rowValue of asArray(raw)) {
    const row = asRecord(rowValue);
    const base = asString(row?.base);
    const quote = asString(row?.quote);
    const date = asString(row?.date);
    const rate = asFiniteNumber(row?.rate, Number.NaN);
    if (
      base !== 'EUR'
      || !/^[A-Z]{3}$/.test(quote)
      || quote === 'EUR'
      || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(rate)
      || rate <= 0
    ) {
      continue;
    }
    const observations = byQuote.get(quote) ?? [];
    observations.push({ date, rate });
    byQuote.set(quote, observations);
  }

  let updatedAt = '';
  const rates = [...byQuote.entries()].flatMap(([quote, observations]) => {
    const ordered = observations
      .sort((left, right) => left.date.localeCompare(right.date))
      .filter((entry, index, all) =>
        index === all.length - 1 || entry.date !== all[index + 1]?.date);
    if (ordered.length < 2) return [];
    const latest = ordered[ordered.length - 1]!;
    const previous = ordered[ordered.length - 2]!;
    if (latest.date > updatedAt) updatedAt = latest.date;
    return [{
      pair: `EUR${quote}`,
      rate: Number(latest.rate.toFixed(6)),
      date: latest.date,
      change1d: Number((latest.rate - previous.rate).toFixed(6)),
    }];
  });

  return { rates, updatedAt };
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
  assertUpstreamArrayPayload(raw, 'features', 'NWS');
  const alerts = normalizeWeatherAlerts(raw);
  return {
    name: 'weather-alerts',
    key: `${TOPMAN_CORE_PREFIX}:data:weather-alerts:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:weather-alerts:v1`,
    ttlSeconds: 45 * 60,
    sourceVersion: 'topman-nws-active-v1',
    schemaVersion: 1,
    coverage: 'focused',
    data: { alerts },
    recordCount: alerts.length,
  };
}

async function naturalDataset(): Promise<PublishableDataset> {
  const raw = await fetchJson(
    'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30',
    'NASA EONET',
  );
  assertUpstreamArrayPayload(raw, 'events', 'NASA EONET');
  const events = normalizeNaturalEvents(raw);
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
    '(Thailand OR ASEAN OR Myanmar OR Cambodia OR "South China Sea") sourcelang:eng',
  );
  const raw = await fetchJson(
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=25&format=json&sort=date&timespan=12h`,
    'GDELT',
    GDELT_FETCH_TIMEOUT_MS,
    1,
  );
  const articles = normalizeGdeltArticles(raw);
  if (articles.length === 0) throw new Error('GDELT returned no usable articles');
  const fetchedAt = new Date().toISOString();
  const militaryTerms = /\b(military|army|navy|airstrike|missile|troop|warship|conflict|war)\b/i;
  const maritimeTerms = /\b(sea|naval|ship|maritime|strait|port|coast)\b/i;
  const military = articles.filter((article) => militaryTerms.test(asString(article.title)));
  const maritime = articles.filter((article) => maritimeTerms.test(asString(article.title)));
  const topics = [
    ...(military.length > 0
      ? [{ id: 'military', articles: military.slice(0, 15), fetchedAt }]
      : []),
    { id: 'intelligence', articles: articles.slice(0, 20), fetchedAt },
    ...(maritime.length > 0
      ? [{ id: 'maritime', articles: maritime.slice(0, 15), fetchedAt }]
      : []),
  ];
  const hasFocusedCoverage = military.length > 0 && maritime.length > 0;
  const publishedRecordCount = countUniqueGdeltTopicArticles(topics);
  return {
    name: 'gdelt-intel',
    key: `${TOPMAN_CORE_PREFIX}:data:gdelt-intel:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:gdelt-intel:v1`,
    ttlSeconds: 24 * 60 * 60,
    sourceVersion: 'topman-gdelt-asean-v1',
    schemaVersion: 1,
    state: hasFocusedCoverage ? 'OK' : 'PARTIAL',
    coverage: hasFocusedCoverage ? 'focused' : 'partial',
    data: { topics, fetchedAt },
    recordCount: publishedRecordCount,
  };
}

export async function fetchCommodityQuotes(
  fetcher: typeof fetchJson = fetchJson,
  wait: (ms: number) => Promise<void> = delay,
): Promise<Array<Record<string, unknown>>> {
  const settled = await Promise.allSettled(COMMODITIES.map(async (metadata, index) => {
    if (index > 0) await wait(index * YAHOO_STAGGER_MS);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(metadata.symbol)}?range=5d&interval=1h`;
    return normalizeYahooQuote(await fetcher(url, `Yahoo ${metadata.symbol}`), metadata);
  }));
  return settled.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []);
}

async function commoditiesDataset(): Promise<PublishableDataset> {
  const quotes = await fetchCommodityQuotes();
  if (quotes.length < 3) throw new Error(`Yahoo returned only ${quotes.length} usable commodity quotes`);
  const hasFullCoverage = quotes.length === COMMODITIES.length;
  return {
    name: 'commodities',
    key: `${TOPMAN_CORE_PREFIX}:data:commodities:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:commodities:v1`,
    ttlSeconds: 45 * 60,
    sourceVersion: 'topman-yahoo-chart-v1',
    schemaVersion: 1,
    state: hasFullCoverage ? 'OK' : 'PARTIAL',
    coverage: hasFullCoverage ? 'full' : 'partial',
    data: { quotes },
    recordCount: quotes.length,
  };
}

async function fxDataset(): Promise<PublishableDataset> {
  const fromDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const raw = await fetchJson(
    `https://api.frankfurter.dev/v2/rates?base=EUR&providers=ECB&from=${fromDate}`,
    'Frankfurter ECB FX',
  );
  const { rates, updatedAt } = normalizeEcbFxSeries(raw);
  if (rates.length < 10) throw new Error('Frankfurter returned insufficient FX coverage');
  const observedAt = Date.parse(updatedAt);
  const now = Date.now();
  if (
    !Number.isFinite(observedAt)
    || observedAt > now + FX_FUTURE_TOLERANCE_MS
    || now - observedAt > FX_MAX_CONTENT_AGE_MS
  ) {
    throw new TopmanUpstreamError(
      'Frankfurter returned stale or invalid ECB observation coverage',
      'INVALID_PAYLOAD',
    );
  }
  const seededAt = now;
  return {
    name: 'fx-rates',
    key: `${TOPMAN_CORE_PREFIX}:data:fx-rates:v1`,
    metaKey: `${TOPMAN_CORE_PREFIX}:meta:fx-rates:v1`,
    ttlSeconds: 25 * 60 * 60,
    sourceVersion: 'topman-frankfurter-ecb-v3',
    schemaVersion: 3,
    coverage: 'full',
    data: {
      rates,
      updatedAt,
      seededAt: String(seededAt),
      unavailable: false,
    },
    recordCount: rates.length,
  };
}

function datasetFactories(
  group: RefreshGroup,
): Array<{ name: string; run: () => Promise<PublishableDataset> }> {
  if (group === 'fast') {
    return [
      { name: 'earthquakes', run: earthquakeDataset },
      { name: 'weather-alerts', run: weatherDataset },
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

function attemptKey(name: string): string {
  return `${TOPMAN_CORE_PREFIX}:attempt:${name}:v1`;
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
        state: dataset.state ?? 'OK',
        data: dataset.data,
      })),
      JSON.stringify({
        fetchedAt,
        recordCount: dataset.recordCount,
        sourceVersion: dataset.sourceVersion,
        scope: 'topman-core',
        state: dataset.state ?? 'OK',
        coverage: dataset.coverage ?? 'focused',
      }),
      String(dataset.ttlSeconds),
      String(metaTtlSeconds),
    );
  }

  const command = ['EVAL', ATOMIC_PUBLISH_SCRIPT, String(keys.length), ...keys, ...args];
  const response = await executePipeline([command], 10_000);
  return validSinglePipelineResult(response, datasets.length);
}

export async function recordRefreshAttempts(
  attempts: RefreshAttempt[],
  executePipeline: RedisPipelineExecutor = redisPipeline,
): Promise<boolean> {
  if (
    attempts.length === 0
    || attempts.some((attempt) =>
      !/^[a-z0-9-]+$/.test(attempt.name)
      || !Number.isSafeInteger(attempt.attemptedAt)
      || attempt.attemptedAt <= 0
      || !Number.isFinite(attempt.durationMs)
      || attempt.durationMs < 0)
  ) {
    return false;
  }

  const commands = attempts.map((attempt) => [
    'SET',
    attemptKey(attempt.name),
    JSON.stringify({
      attemptedAt: attempt.attemptedAt,
      status: attempt.status,
      durationMs: Math.round(attempt.durationMs),
      ...(attempt.recordCount !== undefined ? { recordCount: attempt.recordCount } : {}),
      ...(attempt.coverage ? { coverage: attempt.coverage } : {}),
      ...(attempt.errorCategory ? { errorCategory: attempt.errorCategory } : {}),
    }),
    'EX',
    String(META_TTL_SECONDS),
  ]);
  const response = await executePipeline(commands, 5_000);
  if (!Array.isArray(response) || response.length !== commands.length) return false;
  return response.every((entry) => asRecord(entry)?.error == null && asRecord(entry)?.result === 'OK');
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

type NodeLikeRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
};

type NodeLikeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Uint8Array) => void;
};

function isNodeLikeResponse(value: unknown): value is NodeLikeResponse {
  return value != null
    && typeof value === 'object'
    && typeof (value as NodeLikeResponse).end === 'function'
    && typeof (value as NodeLikeResponse).setHeader === 'function';
}

function incomingToRequest(req: NodeLikeRequest): Request {
  const host = typeof req.headers.host === 'string' ? req.headers.host : 'localhost';
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = typeof protoHeader === 'string' ? protoHeader.split(',')[0]!.trim() : 'https';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request(`${proto}://${host}${req.url ?? '/'}`, {
    method: req.method ?? 'GET',
    headers,
  });
}

async function writeNodeResponse(res: NodeLikeResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

export async function handleRefresh(request: Request): Promise<Response> {
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
    const attemptedAt = Date.now();
    const settled = await Promise.all(factories.map(async (factory) => {
      const startedAt = Date.now();
      try {
        const dataset = await factory.run();
        dataset.durationMs = Math.max(0, Date.now() - startedAt);
        return { ok: true as const, dataset };
      } catch (error) {
        return {
          ok: false as const,
          error,
          durationMs: Math.max(0, Date.now() - startedAt),
        };
      }
    }));
    const datasets: PublishableDataset[] = [];
    const attempts: RefreshAttempt[] = [];
    const results: RefreshResult[] = settled.map((result, index) => {
      const factoryName = factories[index]?.name ?? `${group}-${index + 1}`;
      if (result.ok) {
        datasets.push(result.dataset);
        attempts.push({
          name: result.dataset.name,
          attemptedAt,
          status: result.dataset.state ?? 'OK',
          recordCount: result.dataset.recordCount,
          coverage: result.dataset.coverage ?? 'focused',
          durationMs: result.dataset.durationMs ?? 0,
        });
        return {
          name: result.dataset.name,
          status: 'published',
          recordCount: result.dataset.recordCount,
          coverage: result.dataset.coverage ?? 'focused',
          durationMs: result.dataset.durationMs,
        };
      }
      const errorCategory = classifyRefreshError(result.error);
      attempts.push({
        name: factoryName,
        attemptedAt,
        status: 'FAILED',
        durationMs: result.durationMs,
        errorCategory,
      });
      console.warn(JSON.stringify({
        event: 'topman_core_refresh_dataset',
        group,
        dataset: factoryName,
        outcome: 'failed',
        errorCategory,
        durationMs: result.durationMs,
      }));
      return {
        name: factoryName,
        status: 'failed',
        errorCategory,
        durationMs: result.durationMs,
        reason: errorMessage(result.error).slice(0, 180),
      };
    });

    if (datasets.length > 0 && !await publishDatasets(datasets, Date.now())) {
      const publishFailedAttempts = attempts.map((attempt) => attempt.status === 'FAILED'
        ? attempt
        : {
            ...attempt,
            status: 'FAILED' as const,
            errorCategory: 'REDIS_PUBLISH_FAILED',
          });
      await recordRefreshAttempts(publishFailedAttempts);
      return jsonResponse({
        ok: false,
        status: 'PUBLISH_FAILED',
        group,
        results: results.map((result) => result.status === 'published'
          ? { ...result, status: 'failed', reason: 'Redis publish failed' }
          : result),
      }, 503, { 'Cache-Control': 'no-store' });
    }

    if (!await recordRefreshAttempts(attempts)) {
      return jsonResponse({
        ok: false,
        status: 'ATTEMPT_RECORD_FAILED',
        group,
        results,
      }, 503, { 'Cache-Control': 'no-store' });
    }

    const failed = results.filter((result) => result.status === 'failed');
    const partialCoverage = datasets.some((dataset) => dataset.state === 'PARTIAL');
    console.info(JSON.stringify({
      event: 'topman_core_refresh_group',
      group,
      outcome: failed.length > 0 ? 'failed' : partialCoverage ? 'partial' : 'ok',
      published: datasets.length,
      failed: failed.length,
      attemptedAt,
    }));
    return jsonResponse({
      ok: failed.length === 0,
      status: failed.length > 0
        ? datasets.length > 0 ? 'PARTIAL' : 'FAILED'
        : partialCoverage ? 'PARTIAL' : 'OK',
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

export default async function handler(
  req: Request | NodeLikeRequest,
  res?: NodeLikeResponse,
): Promise<Response | void> {
  if (isNodeLikeResponse(res)) {
    await writeNodeResponse(res, await handleRefresh(incomingToRequest(req as NodeLikeRequest)));
    return;
  }
  return handleRefresh(req as Request);
}
