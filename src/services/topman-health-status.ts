import {
  getTopmanLanguageMode,
  type TopmanLanguageMode,
} from '@/services/i18n';

export type TopmanHealthState = 'healthy' | 'partial' | 'stale' | 'unavailable';

export interface TopmanHealthSummary {
  total: number;
  ok: number;
  warn: number;
  onDemandWarn: number;
  staleContent: number;
  crit: number;
}

export interface TopmanHealthSnapshot {
  state: TopmanHealthState;
  sourceStatus: string | null;
  summary: TopmanHealthSummary;
  checkedAtMs: number | null;
}

export interface TopmanHealthPresentation {
  state: TopmanHealthState;
  label: string;
  description: string;
}

interface FetchTopmanHealthOptions {
  endpoint?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface StartTopmanHealthOptions extends FetchTopmanHealthOptions {
  root?: ParentNode;
  pollIntervalMs?: number;
}

const HEALTH_ENDPOINT = '/api/topman-core-status';
const HEALTH_CHECK_MAX_AGE_MS = 5 * 60_000;
export const TOPMAN_HEALTH_POLL_INTERVAL_MS = 5 * 60_000;
const HEALTH_REQUEST_TIMEOUT_MS = 10_000;
const TOPMAN_SOURCE_REPO_URL = 'https://github.com/Topman3579/topmanidmb-world-monitor';

const EMPTY_SUMMARY: TopmanHealthSummary = {
  total: 0,
  ok: 0,
  warn: 0,
  onDemandWarn: 0,
  staleContent: 0,
  crit: 0,
};

const HEALTH_STATE_CLASSES = [
  'status-indicator--health-healthy',
  'status-indicator--health-partial',
  'status-indicator--health-stale',
  'status-indicator--health-unavailable',
] as const;

const UPSTREAM_CONNECTIVITY_CLASSES = [
  'status-indicator--cached',
  'status-indicator--unavailable',
] as const;

function unavailableSnapshot(): TopmanHealthSnapshot {
  return {
    state: 'unavailable',
    sourceStatus: null,
    summary: { ...EMPTY_SUMMARY },
    checkedAtMs: null,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function parseSummary(value: unknown): TopmanHealthSummary | null {
  if (!isObject(value)) return null;

  const total = readNonNegativeInteger(value.total);
  const ok = readNonNegativeInteger(value.ok);
  const warn = readNonNegativeInteger(value.warn);
  const onDemandWarn = readNonNegativeInteger(value.onDemandWarn);
  const staleContent = readNonNegativeInteger(value.staleContent);
  const crit = readNonNegativeInteger(value.crit);

  if (
    total === null
    || total !== 6
    || ok === null
    || warn === null
    || onDemandWarn === null
    || staleContent === null
    || crit === null
  ) {
    return null;
  }

  // staleContent is a subset of warn. The other four buckets must account for
  // every check exactly once; rejecting contradictory counts keeps the header
  // fail-closed instead of showing a falsely reassuring state.
  if (ok + warn + onDemandWarn + crit !== total || staleContent > warn) {
    return null;
  }

  return { total, ok, warn, onDemandWarn, staleContent, crit };
}

function bilingualText(thai: string, english: string, mode: TopmanLanguageMode): string {
  if (mode === 'th') return thai;
  if (mode === 'en') return english;
  return `${thai} / ${english}`;
}

export function formatTopmanHealthLabel(
  state: TopmanHealthState,
  mode: TopmanLanguageMode,
): string {
  switch (state) {
    case 'healthy':
      return bilingualText('ข้อมูลหลักพร้อม', 'Core ready', mode);
    case 'partial':
      return bilingualText('ข้อมูลหลักบางส่วน', 'Core partial', mode);
    case 'stale':
      return bilingualText('ข้อมูลหลักล่าช้า', 'Core stale', mode);
    case 'unavailable':
      return bilingualText('ข้อมูลหลักไม่พร้อม', 'Core unavailable', mode);
  }
}

function formatCheckedAt(checkedAtMs: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(checkedAtMs));
  } catch {
    return new Date(checkedAtMs).toISOString();
  }
}

function formatCheckedAtDescription(
  checkedAtMs: number | null,
  mode: TopmanLanguageMode,
): string {
  if (checkedAtMs === null) {
    return bilingualText('ยังยืนยันไม่ได้', 'Not verified', mode);
  }

  const thai = `ตรวจล่าสุด ${formatCheckedAt(checkedAtMs, 'th-TH')}`;
  const english = `Last checked ${formatCheckedAt(checkedAtMs, 'en-GB')}`;
  return bilingualText(thai, english, mode);
}

function formatCounts(summary: TopmanHealthSummary, mode: TopmanLanguageMode): string {
  const thai = `TOPMAN Core ${summary.total} ชุด · พร้อม ${summary.ok}/${summary.total} · เตือน ${summary.warn} · ตามคำขอ ${summary.onDemandWarn} · วิกฤต ${summary.crit}`;
  const english = `TOPMAN Core ${summary.total} lanes · OK ${summary.ok}/${summary.total} · warnings ${summary.warn} · on demand ${summary.onDemandWarn} · critical ${summary.crit}`;

  if (mode === 'th') return thai;
  if (mode === 'en') return english;
  return `TOPMAN Core ${summary.total} ชุด/lanes · พร้อม/OK ${summary.ok}/${summary.total} · เตือน/Warnings ${summary.warn} · ตามคำขอ/On demand ${summary.onDemandWarn} · วิกฤต/Critical ${summary.crit}`;
}

export function buildTopmanHealthPresentation(
  snapshot: TopmanHealthSnapshot,
  mode: TopmanLanguageMode,
): TopmanHealthPresentation {
  const label = formatTopmanHealthLabel(snapshot.state, mode);
  const details = [label, formatCheckedAtDescription(snapshot.checkedAtMs, mode)];
  if (snapshot.summary.total > 0) {
    details.push(formatCounts(snapshot.summary, mode));
  }

  return {
    state: snapshot.state,
    label,
    description: details.join(' · '),
  };
}

export function getInitialTopmanHealthPresentation(
  mode: TopmanLanguageMode = getTopmanLanguageMode(),
): TopmanHealthPresentation {
  return buildTopmanHealthPresentation(unavailableSnapshot(), mode);
}

export function classifyTopmanHealthPayload(
  payload: unknown,
  nowMs = Date.now(),
): TopmanHealthSnapshot {
  if (!isObject(payload) || typeof payload.status !== 'string') {
    return unavailableSnapshot();
  }

  const checkedAtMs = typeof payload.checkedAt === 'string'
    ? Date.parse(payload.checkedAt)
    : NaN;

  if (
    !Number.isFinite(checkedAtMs)
    || checkedAtMs > nowMs + 60_000
  ) {
    return unavailableSnapshot();
  }

  const sourceStatus = payload.status.toUpperCase();
  if (sourceStatus === 'REDIS_DOWN') {
    return {
      state: 'unavailable',
      sourceStatus,
      summary: { ...EMPTY_SUMMARY },
      checkedAtMs,
    };
  }

  const summary = parseSummary(payload.summary);
  if (!summary) return unavailableSnapshot();

  const statusMatchesSummary = (
    sourceStatus === 'HEALTHY'
      ? summary.ok === summary.total
        && summary.warn === 0
        && summary.onDemandWarn === 0
        && summary.staleContent === 0
        && summary.crit === 0
      : sourceStatus === 'WARNING'
        ? summary.warn > 0 && summary.onDemandWarn === 0 && summary.crit === 0
        : sourceStatus === 'UNHEALTHY'
          ? summary.onDemandWarn === 0 && summary.crit > 0
          : false
  );
  if (!statusMatchesSummary) return unavailableSnapshot();

  let state: TopmanHealthState;

  if (nowMs - checkedAtMs > HEALTH_CHECK_MAX_AGE_MS) {
    state = 'stale';
  } else if (sourceStatus === 'UNHEALTHY') {
    // Any critical gap forbids the green state. A deployment with at least one
    // healthy check is partial; one with no healthy checks is unavailable.
    state = summary.ok > 0 ? 'partial' : 'unavailable';
  } else if (sourceStatus === 'HEALTHY') {
    state = 'healthy';
  } else if (sourceStatus === 'WARNING') {
    // `warn` also includes non-staleness conditions such as SEED_ERROR,
    // REDIS_PARTIAL, and COVERAGE_PARTIAL. Only the explicit stale-content
    // sub-count is safe to describe as stale from the compact summary alone.
    state = summary.staleContent > 0 ? 'stale' : 'partial';
  } else {
    return unavailableSnapshot();
  }

  return {
    state,
    sourceStatus,
    summary,
    checkedAtMs,
  };
}

export async function fetchTopmanHealthSnapshot(
  options: FetchTopmanHealthOptions = {},
): Promise<TopmanHealthSnapshot> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const now = options.now ?? Date.now;

  if (typeof fetchFn !== 'function') return unavailableSnapshot();

  const requestController = new AbortController();
  const abortFromCaller = (): void => requestController.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const request = async (): Promise<TopmanHealthSnapshot> => {
      const response = await fetchFn(options.endpoint ?? HEALTH_ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        signal: requestController.signal,
      });

      const payload = await response.json();
      const snapshot = classifyTopmanHealthPayload(payload, now());

      // Parse REDIS_DOWN bodies on their intentional HTTP 503 path. Every other
      // non-2xx response is transport failure and must stay unavailable.
      if (!response.ok && snapshot.sourceStatus !== 'REDIS_DOWN') {
        return unavailableSnapshot();
      }
      return snapshot;
    };

    const timeout = new Promise<TopmanHealthSnapshot>((resolve) => {
      timeoutId = setTimeout(() => {
        requestController.abort(new DOMException('TOPMAN health request timed out', 'TimeoutError'));
        resolve(unavailableSnapshot());
      }, Math.max(1, options.timeoutMs ?? HEALTH_REQUEST_TIMEOUT_MS));
    });

    return await Promise.race([request(), timeout]);
  } catch {
    return unavailableSnapshot();
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

function applyPresentation(
  indicator: HTMLElement,
  snapshot: TopmanHealthSnapshot,
): void {
  const presentation = buildTopmanHealthPresentation(snapshot, getTopmanLanguageMode());
  const label = indicator.querySelector<HTMLElement>('[data-topman-health-label]');

  for (const className of [...HEALTH_STATE_CLASSES, ...UPSTREAM_CONNECTIVITY_CLASSES]) {
    indicator.classList.remove(className);
  }
  indicator.classList.add(`status-indicator--health-${presentation.state}`);
  indicator.dataset.topmanHealthState = presentation.state;
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.setAttribute('aria-atomic', 'true');
  indicator.setAttribute('aria-label', presentation.description);
  indicator.title = presentation.description;
  if (label) label.textContent = presentation.label;
}

function presentationMatches(
  indicator: HTMLElement,
  snapshot: TopmanHealthSnapshot,
): boolean {
  const presentation = buildTopmanHealthPresentation(snapshot, getTopmanLanguageMode());
  const label = indicator.querySelector<HTMLElement>('[data-topman-health-label]');

  return indicator.dataset.topmanHealthState === presentation.state
    && indicator.classList.contains(`status-indicator--health-${presentation.state}`)
    && !UPSTREAM_CONNECTIVITY_CLASSES.some((className) => indicator.classList.contains(className))
    && label?.textContent === presentation.label
    && indicator.getAttribute('aria-label') === presentation.description
    && indicator.title === presentation.description;
}

export function startTopmanHealthStatus(
  options: StartTopmanHealthOptions = {},
): () => void {
  const root = options.root ?? (typeof document !== 'undefined' ? document : null);
  const indicator = root?.querySelector<HTMLElement>('.status-indicator--topman-health');
  if (!indicator) return () => {};

  let destroyed = false;
  let requestGeneration = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let activeAbort: AbortController | null = null;
  let latestSnapshot = unavailableSnapshot();

  const scheduleNext = (): void => {
    if (destroyed) return;
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = setTimeout(
      () => { void refresh(); },
      Math.max(30_000, options.pollIntervalMs ?? TOPMAN_HEALTH_POLL_INTERVAL_MS),
    );
  };

  const refresh = async (): Promise<void> => {
    const generation = ++requestGeneration;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    activeAbort?.abort();
    activeAbort = new AbortController();

    const snapshot = await fetchTopmanHealthSnapshot({
      endpoint: options.endpoint,
      fetchFn: options.fetchFn,
      now: options.now,
      signal: activeAbort.signal,
      timeoutMs: options.timeoutMs,
    });

    if (destroyed || generation !== requestGeneration) return;
    latestSnapshot = snapshot;
    applyPresentation(indicator, latestSnapshot);
    scheduleNext();
  };

  applyPresentation(indicator, latestSnapshot);

  const observer = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(() => {
      // App.ts still owns the offline/cache banner and may temporarily rewrite
      // this shared header element. Restore the independently verified health
      // verdict without changing that separate banner.
      if (!destroyed && !presentationMatches(indicator, latestSnapshot)) {
        applyPresentation(indicator, latestSnapshot);
      }
    });
  observer?.observe(indicator, {
    attributes: true,
    attributeFilter: ['class', 'data-topman-health-state', 'aria-label', 'title'],
    childList: true,
    characterData: true,
    subtree: true,
  });

  const refreshWhenOnline = (): void => { void refresh(); };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', refreshWhenOnline);
  }

  void refresh();

  return () => {
    destroyed = true;
    requestGeneration += 1;
    activeAbort?.abort();
    activeAbort = null;
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    observer?.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', refreshWhenOnline);
    }
  };
}

export function getTopmanSourceHref(buildHash: string): string {
  const normalized = buildHash.trim().toLowerCase();
  if (/^[0-9a-f]{7,40}$/.test(normalized)) {
    return `${TOPMAN_SOURCE_REPO_URL}/commit/${normalized}`;
  }
  return TOPMAN_SOURCE_REPO_URL;
}

export function getTopmanSourceTitle(
  buildHash: string,
  mode: TopmanLanguageMode = getTopmanLanguageMode(),
): string {
  const normalized = buildHash.trim().toLowerCase();
  const suffix = /^[0-9a-f]{7,40}$/.test(normalized)
    ? ` · ${normalized.slice(0, 7)}`
    : '';
  return bilingualText(
    `ซอร์ส TOPMANIDMB${suffix}`,
    `TOPMANIDMB source${suffix}`,
    mode,
  );
}

/** Compact full-system health (232+ checks) — separate from TOPMAN Core 6. */
export type SystemHealthState = 'healthy' | 'partial' | 'unavailable';

export interface SystemHealthBrief {
  state: SystemHealthState;
  sourceStatus: string | null;
  ok: number;
  total: number;
  crit: number;
  checkedAtMs: number | null;
}

const SYSTEM_HEALTH_ENDPOINT = '/api/health?compact=1';

function unavailableSystemBrief(): SystemHealthBrief {
  return {
    state: 'unavailable',
    sourceStatus: null,
    ok: 0,
    total: 0,
    crit: 0,
    checkedAtMs: null,
  };
}

export function classifyCompactSystemHealth(
  payload: unknown,
  nowMs = Date.now(),
): SystemHealthBrief {
  if (!isObject(payload) || typeof payload.status !== 'string') {
    return unavailableSystemBrief();
  }

  const checkedAtMs = typeof payload.checkedAt === 'string'
    ? Date.parse(payload.checkedAt)
    : NaN;
  if (!Number.isFinite(checkedAtMs) || checkedAtMs > nowMs + 60_000) {
    return unavailableSystemBrief();
  }

  const summary = isObject(payload.summary) ? payload.summary : null;
  const total = summary ? readNonNegativeInteger(summary.total) : null;
  const ok = summary ? readNonNegativeInteger(summary.ok) : null;
  const crit = summary ? readNonNegativeInteger(summary.crit) : null;
  if (total === null || total < 1 || ok === null || crit === null) {
    return unavailableSystemBrief();
  }

  const sourceStatus = payload.status.toUpperCase();
  let state: SystemHealthState;
  if (sourceStatus === 'HEALTHY' && crit === 0 && ok === total) {
    state = 'healthy';
  } else if (sourceStatus === 'WARNING' || sourceStatus === 'UNHEALTHY' || crit > 0 || ok < total) {
    state = 'partial';
  } else {
    return unavailableSystemBrief();
  }

  return {
    state,
    sourceStatus,
    ok,
    total,
    crit,
    checkedAtMs,
  };
}

export function formatSystemHealthBrief(
  brief: SystemHealthBrief,
  mode: TopmanLanguageMode = getTopmanLanguageMode(),
): string {
  if (brief.state === 'unavailable' || brief.total < 1) {
    return bilingualText(
      'ระบบเต็ม: ยังยืนยันไม่ได้',
      'Full system: not verified',
      mode,
    );
  }

  const thaiState = brief.state === 'healthy'
    ? 'พร้อม'
    : brief.crit > 0
      ? 'ไม่พร้อม'
      : 'พร้อมบางส่วน';
  const enState = brief.state === 'healthy'
    ? 'ready'
    : brief.crit > 0
      ? 'not ready'
      : 'partial';

  return bilingualText(
    `ระบบเต็ม: ${thaiState} ${brief.ok}/${brief.total}${brief.crit > 0 ? ` · วิกฤต ${brief.crit}` : ''}`,
    `Full system: ${enState} ${brief.ok}/${brief.total}${brief.crit > 0 ? ` · critical ${brief.crit}` : ''}`,
    mode,
  );
}

export async function fetchCompactSystemHealthBrief(
  options: FetchTopmanHealthOptions = {},
): Promise<SystemHealthBrief> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  if (typeof fetchFn !== 'function') return unavailableSystemBrief();

  const requestController = new AbortController();
  const abortFromCaller = (): void => requestController.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const request = async (): Promise<SystemHealthBrief> => {
      const response = await fetchFn(options.endpoint ?? SYSTEM_HEALTH_ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        signal: requestController.signal,
      });
      if (!response.ok) return unavailableSystemBrief();
      const payload = await response.json();
      return classifyCompactSystemHealth(payload, now());
    };

    const timeout = new Promise<SystemHealthBrief>((resolve) => {
      timeoutId = setTimeout(() => {
        requestController.abort(new DOMException('System health request timed out', 'TimeoutError'));
        resolve(unavailableSystemBrief());
      }, Math.max(1, options.timeoutMs ?? HEALTH_REQUEST_TIMEOUT_MS));
    });

    return await Promise.race([request(), timeout]);
  } catch {
    return unavailableSystemBrief();
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function formatCoreHealthStrip(
  snapshot: TopmanHealthSnapshot | null | undefined,
  mode: TopmanLanguageMode = getTopmanLanguageMode(),
): string {
  if (!snapshot || snapshot.summary.total < 1) {
    return bilingualText(
      'ข้อมูลหลัก TOPMAN: ยังยืนยันไม่ได้',
      'TOPMAN Core: not verified',
      mode,
    );
  }
  const { ok, total, warn, crit } = snapshot.summary;
  return bilingualText(
    `ข้อมูลหลัก TOPMAN: ${ok}/${total} · เตือน ${warn} · วิกฤต ${crit}`,
    `TOPMAN Core: ${ok}/${total} · warnings ${warn} · critical ${crit}`,
    mode,
  );
}
