import { getHydratedData } from '@/services/bootstrap';
import { toApiUrl } from '@/services/runtime';

export interface ServerInsightStory {
  primaryTitle: string;
  primarySource: string;
  primaryLink: string;
  pubDate: string;
  sourceCount: number;
  importanceScore: number;
  velocity: { level: string; sourcesPerHour: number };
  isAlert: boolean;
  category: string;
  threatLevel: string;
  countryCode: string | null;
}

export interface ServerBriefSource {
  title: string;
  source: string;
  url: string;
  publishedAt?: string;
}

export interface ServerInsights {
  worldBrief: string;
  /** #4921: one cited line per top story from the synthesis call —
   * absent on pre-rollout payloads and single-headline (L2) briefs. */
  briefStoryLines?: Array<{ n: number; text: string }>;
  /** #4921: age window of the source material behind this brief. */
  sourceAgeRange?: { newestMs: number; oldestMs: number } | null;
  worldBriefSources?: ServerBriefSource[];
  briefProvider: string;
  status: 'ok' | 'degraded';
  topStories: ServerInsightStory[];
  generatedAt: string;
  clusterCount: number;
  multiSourceCount: number;
  fastMovingCount: number;
  /** #4920 coverage provenance — present on payloads seeded after the
   * completeness-measurement rollout; absent on older cached payloads. */
  provenance?: {
    storiesConsidered: number;
    sourcesConsidered: number;
    selectionDrops?: { admissibility: number; sourceCap: number; overflow: number };
  };
}

let cached: ServerInsights | null = null;
// Server cron interval: scripts/seed-insights.mjs runs every 30 min
// (CACHE_TTL=10800s/3h, maxStaleMin: 30). The previous 15-min freshness gate
// was strictly less than the cron interval, so the panel spent ~50% of every
// 30-min cycle showing UNAVAILABLE + "Waiting for data..." even when the
// system was working perfectly. 60 min = 2× cron interval, gives one full
// missed-tick of headroom before falling through to the client-side path.
// Exported so the regression test asserts against the real value rather than
// inlining a copy that drifts silently when this constant changes.
export const MAX_AGE_MS = 60 * 60 * 1000;
// Public GDELT is a last-good fallback for the branded dashboard when the
// private `insights` snapshot is absent. Its producer runs less frequently than
// the synthesized brief, so keep the source timestamp and use the same 12-hour
// budget as the GDELT health lane instead of pretending the headlines are new.
export const PUBLIC_GDELT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const PUBLIC_GDELT_PROVIDER = 'gdelt-public-fallback';

function isFresh(data: ServerInsights): boolean {
  const age = Date.now() - new Date(data.generatedAt).getTime();
  const maxAge = data.briefProvider === PUBLIC_GDELT_PROVIDER
    ? PUBLIC_GDELT_MAX_AGE_MS
    : MAX_AGE_MS;
  return age >= 0 && age < maxAge;
}

interface PublicGdeltArticle {
  title?: unknown;
  url?: unknown;
  source?: unknown;
  date?: unknown;
}

interface PublicGdeltTopic {
  id?: unknown;
  articles?: unknown;
}

function gdeltDateToIso(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
    return Number.isFinite(Date.parse(iso)) ? iso : '';
  }
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
}

/**
 * Deterministic public fallback: expose cited GDELT headlines without asking an
 * LLM to infer facts. The degraded status is intentional and keeps the Simple
 * Mode honesty guard active.
 */
export function buildServerInsightsFromPublicGdelt(raw: unknown): ServerInsights | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as { topics?: unknown; fetchedAt?: unknown };
  if (!Array.isArray(payload.topics) || typeof payload.fetchedAt !== 'string') return null;

  const fetchedAtMs = Date.parse(payload.fetchedAt);
  const age = Date.now() - fetchedAtMs;
  if (!Number.isFinite(fetchedAtMs) || age < 0 || age >= PUBLIC_GDELT_MAX_AGE_MS) return null;

  const seen = new Set<string>();
  const stories: ServerInsightStory[] = [];
  for (const topic of payload.topics as PublicGdeltTopic[]) {
    if (!topic || !Array.isArray(topic.articles)) continue;
    const category = typeof topic.id === 'string' && topic.id.trim() ? topic.id.trim() : 'general';
    for (const article of topic.articles as PublicGdeltArticle[]) {
      const title = typeof article?.title === 'string' ? article.title.trim() : '';
      const link = typeof article?.url === 'string' ? article.url.trim() : '';
      const source = typeof article?.source === 'string' ? article.source.trim() : '';
      const key = title.toLocaleLowerCase();
      if (!title || !link || !source || seen.has(key)) continue;
      seen.add(key);
      stories.push({
        primaryTitle: title,
        primarySource: source,
        primaryLink: link,
        pubDate: gdeltDateToIso(article.date),
        sourceCount: 1,
        importanceScore: 0,
        velocity: { level: 'unknown', sourcesPerHour: 0 },
        isAlert: false,
        category,
        threatLevel: 'unknown',
        countryCode: null,
      });
      if (stories.length >= 12) break;
    }
    if (stories.length >= 12) break;
  }
  if (stories.length === 0) return null;

  const leading = stories.slice(0, 3);
  return {
    worldBrief: leading.map((story) => story.primaryTitle).join(' · '),
    worldBriefSources: leading.map((story) => ({
      title: story.primaryTitle,
      source: story.primarySource,
      url: story.primaryLink,
      ...(story.pubDate ? { publishedAt: story.pubDate } : {}),
    })),
    briefProvider: PUBLIC_GDELT_PROVIDER,
    status: 'degraded',
    topStories: stories,
    generatedAt: new Date(fetchedAtMs).toISOString(),
    clusterCount: stories.length,
    multiSourceCount: 0,
    fastMovingCount: 0,
    provenance: {
      storiesConsidered: stories.length,
      sourcesConsidered: new Set(stories.map((story) => story.primarySource)).size,
    },
  };
}

function validateInsights(raw: unknown): ServerInsights | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as ServerInsights;
  if (!Array.isArray(data.topStories) || data.topStories.length === 0) return null;
  if (typeof data.generatedAt !== 'string') return null;
  if (!isFresh(data)) return null;
  return data;
}

export function getServerInsights(): ServerInsights | null {
  if (cached && isFresh(cached)) {
    return cached;
  }
  cached = null;

  const data = validateInsights(getHydratedData('insights'));
  if (data) cached = data;
  return data;
}

/**
 * On-demand refetch of the server-insights snapshot via the bootstrap
 * key-filter endpoint. Used by InsightsPanel when getServerInsights() returns
 * null because the bootstrap hydration cache is empty — typically:
 *   - mobile fast-tier abort on 4G (bootstrap.ts:179 — 1.2 s budget),
 *   - cached value went stale (>MAX_AGE_MS) with no second bootstrap fetch,
 *   - getHydratedData() was already consumed by an earlier failed validation
 *     (it deletes on read; insights-loader.ts validation drained the slot
 *     without caching, leaving subsequent reads with nothing).
 *
 * The bootstrap API supports `?keys=insights` filtering (api/bootstrap.js:250)
 * and is CDN-cached (s-maxage=600 for fast tier), so polling is cheap.
 * Mirrors the AAIISentimentPanel fallback shape (AAIISentimentPanel.ts:147).
 *
 * Returns the validated insights on success, null on any failure (network,
 * timeout, validation). Caches the value module-locally on success so
 * subsequent getServerInsights() calls return it without re-fetching.
 */
export async function fetchServerInsights(timeoutMs = 5_000): Promise<ServerInsights | null> {
  if (cached && isFresh(cached)) return cached;
  try {
    const resp = await fetch(toApiUrl('/api/bootstrap?keys=insights'), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (resp.ok) {
      const payload = (await resp.json()) as { data?: { insights?: unknown } };
      const data = validateInsights(payload.data?.insights);
      if (data) {
        cached = data;
        return data;
      }
    }
  } catch {
    // Continue to the public, deterministic fallback below.
  }

  try {
    const resp = await fetch(toApiUrl('/api/bootstrap?tier=fast&public=1'), {
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'omit',
    });
    if (!resp.ok) return null;
    const payload = (await resp.json()) as { data?: { gdeltIntel?: unknown } };
    const data = buildServerInsightsFromPublicGdelt(payload.data?.gdeltIntel);
    if (data) cached = data;
    return data;
  } catch {
    return null;
  }
}

export function setServerInsights(data: ServerInsights): void {
  cached = data;
}

/** Test-only: reset module-local cache so suites can exercise the drain-once behavior. */
export function __resetServerInsightsCacheForTests(): void {
  cached = null;
}
