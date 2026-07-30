import { unwrapEnvelope } from './_seed-envelope.js';
import { redisPipeline } from './_upstash-json.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const TOPMAN_CORE_DATASETS = Object.freeze([
  {
    id: 'earthquakes',
    bootstrapName: 'earthquakes',
    dataKey: 'topman:core:data:earthquakes:v1',
    metaKey: 'topman:core:meta:earthquakes:v1',
    attemptKey: 'topman:core:attempt:earthquakes:v1',
    maxAgeMs: HOUR_MS,
    minimumRecords: 1,
  },
  {
    id: 'weather-alerts',
    bootstrapName: 'weatherAlerts',
    dataKey: 'topman:core:data:weather-alerts:v1',
    metaKey: 'topman:core:meta:weather-alerts:v1',
    attemptKey: 'topman:core:attempt:weather-alerts:v1',
    maxAgeMs: 45 * MINUTE_MS,
    minimumRecords: 0,
  },
  {
    id: 'natural-events',
    bootstrapName: 'naturalEvents',
    dataKey: 'topman:core:data:natural-events:v1',
    metaKey: 'topman:core:meta:natural-events:v1',
    attemptKey: 'topman:core:attempt:natural-events:v1',
    maxAgeMs: 7 * HOUR_MS,
    minimumRecords: 0,
  },
  {
    id: 'gdelt-intel',
    bootstrapName: 'gdeltIntel',
    dataKey: 'topman:core:data:gdelt-intel:v1',
    metaKey: 'topman:core:meta:gdelt-intel:v1',
    attemptKey: 'topman:core:attempt:gdelt-intel:v1',
    maxAgeMs: 7 * HOUR_MS,
    minimumRecords: 1,
  },
  {
    id: 'commodities',
    bootstrapName: 'commodityQuotes',
    dataKey: 'topman:core:data:commodities:v1',
    metaKey: 'topman:core:meta:commodities:v1',
    attemptKey: 'topman:core:attempt:commodities:v1',
    maxAgeMs: 45 * MINUTE_MS,
    minimumRecords: 3,
    fullCoverageRecords: 7,
  },
  {
    id: 'fx-rates',
    bootstrapName: 'ecbFxRates',
    dataKey: 'topman:core:data:fx-rates:v1',
    metaKey: 'topman:core:meta:fx-rates:v1',
    attemptKey: 'topman:core:attempt:fx-rates:v1',
    maxAgeMs: 25 * HOUR_MS,
    maxContentAgeMs: 10 * DAY_MS,
    minimumRecords: 10,
  },
]);

const DATASET_BY_BOOTSTRAP_NAME = new Map(
  TOPMAN_CORE_DATASETS.map((dataset) => [dataset.bootstrapName, dataset]),
);

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return isObject(value) ? value : null;
}

function readPipelineValue(entry) {
  if (!isObject(entry) || entry.error != null || !('result' in entry)) {
    throw new Error('TOPMAN core Redis command failed');
  }
  return entry.result;
}

function finiteTimestamp(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function contentTimestampFor(dataset, data) {
  if (dataset.bootstrapName !== 'ecbFxRates' || !isObject(data)) return null;
  const parsed = typeof data.updatedAt === 'string' ? Date.parse(data.updatedAt) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isFocusedEnvelopeFresh(dataset, envelope, nowMs) {
  const fetchedAt = finiteTimestamp(envelope._seed?.fetchedAt);
  const state = envelope._seed?.state;
  if (
    fetchedAt === null
    || fetchedAt > nowMs + MINUTE_MS
    || nowMs - fetchedAt > dataset.maxAgeMs
    || (state !== 'OK' && state !== 'PARTIAL')
  ) {
    return false;
  }

  if (Number.isFinite(dataset.maxContentAgeMs)) {
    const contentTimestamp = contentTimestampFor(dataset, envelope.data);
    if (
      contentTimestamp === null
      || contentTimestamp > nowMs + DAY_MS
      || nowMs - contentTimestamp > dataset.maxContentAgeMs
    ) {
      return false;
    }
  }
  return true;
}

function mergeArrayByIdentity(primary, secondary, identity) {
  const result = [];
  const seen = new Set();

  for (const value of [...primary, ...secondary]) {
    const key = identity(value);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(value);
  }

  return result;
}

function objectIdentity(value, fields) {
  if (!isObject(value)) return null;
  for (const field of fields) {
    if (typeof value[field] === 'string' && value[field]) {
      return `${field}:${value[field]}`;
    }
  }
  return null;
}

function mergeGdeltTopics(primary, secondary) {
  const secondaryById = new Map(
    secondary
      .filter((topic) => isObject(topic) && typeof topic.id === 'string')
      .map((topic) => [topic.id, topic]),
  );
  const merged = [];
  const seenIds = new Set();

  for (const topicValue of primary) {
    if (!isObject(topicValue)) {
      merged.push(topicValue);
      continue;
    }
    const id = typeof topicValue.id === 'string' ? topicValue.id : '';
    const fallback = secondaryById.get(id);
    const primaryArticles = Array.isArray(topicValue.articles) ? topicValue.articles : [];
    const secondaryArticles = Array.isArray(fallback?.articles) ? fallback.articles : [];
    merged.push({
      ...(isObject(fallback) ? fallback : {}),
      ...topicValue,
      articles: mergeArrayByIdentity(
        primaryArticles,
        secondaryArticles,
        (article) => objectIdentity(article, ['url', 'title']),
      ),
    });
    if (id) seenIds.add(id);
  }

  for (const topic of secondary) {
    if (!isObject(topic) || typeof topic.id !== 'string' || !seenIds.has(topic.id)) {
      merged.push(topic);
    }
  }
  return merged;
}

function mergeCoreData(bootstrapName, primary, secondary) {
  const mergedBase = { ...secondary, ...primary };
  switch (bootstrapName) {
    case 'earthquakes':
      return {
        ...mergedBase,
        earthquakes: mergeArrayByIdentity(
          Array.isArray(primary.earthquakes) ? primary.earthquakes : [],
          Array.isArray(secondary.earthquakes) ? secondary.earthquakes : [],
          (row) => objectIdentity(row, ['id']),
        ),
      };
    case 'weatherAlerts':
      return {
        ...mergedBase,
        alerts: mergeArrayByIdentity(
          Array.isArray(primary.alerts) ? primary.alerts : [],
          Array.isArray(secondary.alerts) ? secondary.alerts : [],
          (row) => objectIdentity(row, ['id']),
        ),
      };
    case 'naturalEvents':
      return {
        ...mergedBase,
        events: mergeArrayByIdentity(
          Array.isArray(primary.events) ? primary.events : [],
          Array.isArray(secondary.events) ? secondary.events : [],
          (row) => objectIdentity(row, ['id']),
        ),
      };
    case 'gdeltIntel':
      return {
        ...mergedBase,
        topics: mergeGdeltTopics(
          Array.isArray(primary.topics) ? primary.topics : [],
          Array.isArray(secondary.topics) ? secondary.topics : [],
        ),
      };
    case 'commodityQuotes':
      return {
        ...mergedBase,
        quotes: mergeArrayByIdentity(
          Array.isArray(primary.quotes) ? primary.quotes : [],
          Array.isArray(secondary.quotes) ? secondary.quotes : [],
          (row) => objectIdentity(row, ['symbol']),
        ),
      };
    case 'ecbFxRates':
      return {
        ...mergedBase,
        rates: mergeArrayByIdentity(
          Array.isArray(primary.rates) ? primary.rates : [],
          Array.isArray(secondary.rates) ? secondary.rates : [],
          (row) => objectIdentity(row, ['pair']),
        ),
      };
    default:
      return primary;
  }
}

function recordCountFor(bootstrapName, data) {
  if (!isObject(data)) return 0;
  switch (bootstrapName) {
    case 'earthquakes':
      return Array.isArray(data.earthquakes) ? data.earthquakes.length : 0;
    case 'weatherAlerts':
      return Array.isArray(data.alerts) ? data.alerts.length : 0;
    case 'naturalEvents':
      return Array.isArray(data.events) ? data.events.length : 0;
    case 'gdeltIntel': {
      if (!Array.isArray(data.topics)) return 0;
      const articles = new Set();
      for (const topic of data.topics) {
        if (!Array.isArray(topic?.articles)) continue;
        for (const article of topic.articles) {
          if (!isObject(article)) continue;
          const identity = typeof article.url === 'string' && article.url
            ? article.url
            : typeof article.title === 'string' && article.title
              ? article.title
              : null;
          if (identity) articles.add(identity);
        }
      }
      return articles.size;
    }
    case 'commodityQuotes':
      return Array.isArray(data.quotes) ? data.quotes.length : 0;
    case 'ecbFxRates':
      return Array.isArray(data.rates) ? data.rates.length : 0;
    default:
      return 0;
  }
}

export function isTopmanCoreDataUsable(bootstrapName, data) {
  const dataset = DATASET_BY_BOOTSTRAP_NAME.get(bootstrapName);
  if (!dataset || !isObject(data)) return false;

  const count = recordCountFor(bootstrapName, data);
  if (count < dataset.minimumRecords) return false;

  // Empty weather and natural-event lists are valid observations. Requiring
  // their list properties still distinguishes a valid empty response from a
  // malformed object.
  if (bootstrapName === 'weatherAlerts') return Array.isArray(data.alerts);
  if (bootstrapName === 'naturalEvents') return Array.isArray(data.events);
  return count > 0;
}

export function topmanCoreDataKey(bootstrapName) {
  return DATASET_BY_BOOTSTRAP_NAME.get(bootstrapName)?.dataKey ?? null;
}

export function resolveTopmanCoreProjection(
  bootstrapName,
  canonicalRaw,
  focusedRaw,
  nowMs = Date.now(),
) {
  const dataset = DATASET_BY_BOOTSTRAP_NAME.get(bootstrapName);
  const canonicalEnvelope = unwrapEnvelope(canonicalRaw);
  const focusedEnvelope = unwrapEnvelope(focusedRaw);
  const canonicalData = canonicalEnvelope.data;
  const focusedData = focusedEnvelope.data;

  if (!dataset || !isTopmanCoreDataUsable(bootstrapName, focusedData)) {
    return canonicalData;
  }

  const focusedState = focusedEnvelope._seed?.state;
  if (!isFocusedEnvelopeFresh(dataset, focusedEnvelope, nowMs)) return canonicalData;

  if (!isTopmanCoreDataUsable(bootstrapName, canonicalData)) {
    return focusedData;
  }

  const focusedFetchedAt = finiteTimestamp(focusedEnvelope._seed?.fetchedAt);
  const canonicalFetchedAt = finiteTimestamp(canonicalEnvelope._seed?.fetchedAt);
  const focusedCanLead = focusedState === 'OK'
    && canonicalFetchedAt !== null
    && focusedFetchedAt >= canonicalFetchedAt;
  const primary = focusedCanLead ? focusedData : canonicalData;
  const secondary = focusedCanLead ? canonicalData : focusedData;
  return mergeCoreData(bootstrapName, primary, secondary);
}

function classifyDataset(dataset, dataRaw, metaRaw, attemptRaw, nowMs) {
  const envelope = unwrapEnvelope(readJson(dataRaw));
  const data = envelope.data;
  const meta = readJson(metaRaw);
  const attempt = readJson(attemptRaw);
  const fetchedAt = finiteTimestamp(envelope._seed?.fetchedAt);
  const envelopeState = envelope._seed?.state;
  const publicationContractIsValid = (
    fetchedAt !== null
    && fetchedAt <= nowMs + MINUTE_MS
    && (envelopeState === 'OK' || envelopeState === 'PARTIAL')
  );
  const attemptedAt = finiteTimestamp(attempt?.attemptedAt);
  const contentTimestamp = contentTimestampFor(dataset, data);
  const recordCount = recordCountFor(dataset.bootstrapName, data);
  const publishedCount = Number.isInteger(meta?.recordCount)
    ? Number(meta.recordCount)
    : Number.isInteger(envelope._seed?.recordCount)
      ? Number(envelope._seed.recordCount)
      : null;
  const coverage = typeof meta?.coverage === 'string'
    ? meta.coverage
    : typeof attempt?.coverage === 'string'
      ? attempt.coverage
      : 'focused';

  let state = 'OK';
  if (
    !isTopmanCoreDataUsable(dataset.bootstrapName, data)
    || !publicationContractIsValid
  ) {
    state = 'MISSING';
  } else if (!isFocusedEnvelopeFresh(dataset, envelope, nowMs)) {
    state = 'STALE';
  } else if (
    attempt?.status === 'FAILED'
    && attemptedAt !== null
    && attemptedAt > fetchedAt
  ) {
    state = 'FAILED_USING_LAST_GOOD';
  } else if (
    envelope._seed?.state === 'PARTIAL'
    || coverage === 'partial'
    || (publishedCount !== null && publishedCount !== recordCount)
    || (
      Number.isInteger(dataset.fullCoverageRecords)
      && recordCount < dataset.fullCoverageRecords
    )
  ) {
    state = 'PARTIAL';
  }

  return {
    id: dataset.id,
    bootstrapName: dataset.bootstrapName,
    state,
    recordCount,
    coverage,
    sourceVersion: typeof meta?.sourceVersion === 'string'
      ? meta.sourceVersion
      : typeof envelope._seed?.sourceVersion === 'string'
        ? envelope._seed.sourceVersion
        : null,
    lastSuccessAt: publicationContractIsValid ? new Date(fetchedAt).toISOString() : null,
    lastAttemptAt: attemptedAt === null ? null : new Date(attemptedAt).toISOString(),
    ageSeconds: publicationContractIsValid
      ? Math.max(0, Math.floor((nowMs - fetchedAt) / 1000))
      : null,
    contentAgeSeconds: contentTimestamp === null
      ? null
      : Math.max(0, Math.floor((nowMs - contentTimestamp) / 1000)),
    errorCategory: typeof attempt?.errorCategory === 'string'
      ? attempt.errorCategory
      : null,
    data: isObject(data) ? data : null,
  };
}

export async function readTopmanCoreSnapshot({
  includeData = false,
  executePipeline = redisPipeline,
  now = Date.now,
} = {}) {
  const commands = TOPMAN_CORE_DATASETS.flatMap((dataset) => [
    ['GET', dataset.dataKey],
    ['GET', dataset.metaKey],
    ['GET', dataset.attemptKey],
  ]);
  const response = await executePipeline(commands, 4_000);
  if (!Array.isArray(response) || response.length !== commands.length) {
    throw new Error('TOPMAN core Redis pipeline unavailable');
  }

  const nowMs = now();
  const datasets = TOPMAN_CORE_DATASETS.map((dataset, index) => classifyDataset(
    dataset,
    readPipelineValue(response[index * 3]),
    readPipelineValue(response[index * 3 + 1]),
    readPipelineValue(response[index * 3 + 2]),
    nowMs,
  ));

  const summary = {
    total: datasets.length,
    ok: datasets.filter((dataset) => dataset.state === 'OK').length,
    warn: datasets.filter((dataset) =>
      dataset.state === 'PARTIAL'
      || dataset.state === 'STALE'
      || dataset.state === 'FAILED_USING_LAST_GOOD').length,
    onDemandWarn: 0,
    staleContent: datasets.filter((dataset) => dataset.state === 'STALE').length,
    crit: datasets.filter((dataset) => dataset.state === 'MISSING').length,
  };
  const status = summary.crit > 0
    ? 'UNHEALTHY'
    : summary.warn > 0
      ? 'WARNING'
      : 'HEALTHY';
  const data = Object.fromEntries(
    datasets
      .filter((dataset) => dataset.state !== 'MISSING' && dataset.data !== null)
      .map((dataset) => [dataset.bootstrapName, dataset.data]),
  );

  return {
    status,
    checkedAt: new Date(nowMs).toISOString(),
    summary,
    datasets: datasets.map(({ data: _data, ...dataset }) => dataset),
    ...(includeData
      ? {
          data,
          missing: datasets
            .filter((dataset) => dataset.state === 'MISSING')
            .map((dataset) => dataset.bootstrapName),
        }
      : {}),
  };
}
