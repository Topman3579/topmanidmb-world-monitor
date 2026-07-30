/**
 * TOPMAN Simple / Advanced UI mode preference.
 * Progressive disclosure shell — does not change health semantics or data APIs.
 */

export const TOPMAN_UI_MODE_STORAGE_KEY = 'topman-ui-mode-v1';
export const TOPMAN_UI_MODE_EVENT = 'topman:ui-mode-changed';

export type TopmanUiMode = 'simple' | 'advanced';

const VALID_MODES = new Set<TopmanUiMode>(['simple', 'advanced']);

export function normalizeTopmanUiMode(value: string | null | undefined): TopmanUiMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return VALID_MODES.has(normalized as TopmanUiMode) ? (normalized as TopmanUiMode) : null;
}

export function readTopmanUiModeFromUrl(search: string = typeof window !== 'undefined' ? window.location.search : ''): TopmanUiMode | null {
  try {
    return normalizeTopmanUiMode(new URLSearchParams(search).get('mode'));
  } catch {
    return null;
  }
}

export function storedTopmanUiMode(): TopmanUiMode | null {
  try {
    return normalizeTopmanUiMode(localStorage.getItem(TOPMAN_UI_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Deep-link detail params that require the full dashboard for that session.
 * Map layer strings alone do NOT force advanced — Simple Mode writes its own
 * compact layer set into the URL and must not thrash back to advanced.
 */
export function urlImpliesAdvancedDashboard(search: string = typeof window !== 'undefined' ? window.location.search : ''): boolean {
  try {
    const params = new URLSearchParams(search);
    if (normalizeTopmanUiMode(params.get('mode')) === 'simple') return false;
    if (normalizeTopmanUiMode(params.get('mode')) === 'advanced') return true;
    // Country brief, story, chokepoint, expanded panel
    if (params.get('country') || params.get('c') || params.get('chokepoint')) return true;
    if (params.get('expanded') === '1') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolve mode for first paint:
 * 1. Explicit ?mode=
 * 2. Stored preference (survives map URL sync that rewrites query params)
 * 3. Deep-link advanced intent (only when user has no stored choice yet)
 * 4. Default: simple (new-user friendly)
 */
export function resolveTopmanUiMode(options: {
  search?: string;
  stored?: TopmanUiMode | null;
  defaultMode?: TopmanUiMode;
} = {}): TopmanUiMode {
  const search = options.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const fromUrl = readTopmanUiModeFromUrl(search);
  if (fromUrl) return fromUrl;

  const stored = options.stored !== undefined ? options.stored : storedTopmanUiMode();
  if (stored) return stored;

  if (urlImpliesAdvancedDashboard(search)) return 'advanced';

  return options.defaultMode ?? 'simple';
}

export function saveTopmanUiMode(mode: TopmanUiMode): void {
  try {
    localStorage.setItem(TOPMAN_UI_MODE_STORAGE_KEY, mode);
  } catch {
    // Private mode / storage blocked — session still applies via document class.
  }
}

export function applyTopmanUiModeToDocument(mode: TopmanUiMode, root: HTMLElement | Document = document.documentElement): void {
  const el = root instanceof Document ? root.documentElement : root;
  el.classList.toggle('topman-ui-mode-simple', mode === 'simple');
  el.classList.toggle('topman-ui-mode-advanced', mode === 'advanced');
  el.dataset.topmanUiMode = mode;
}

export function writeTopmanUiModeToUrl(mode: TopmanUiMode, url: URL = new URL(window.location.href)): URL {
  url.searchParams.set('mode', mode);
  return url;
}

export function setTopmanUiMode(
  mode: TopmanUiMode,
  options: { updateUrl?: boolean; dispatch?: boolean } = {},
): TopmanUiMode {
  saveTopmanUiMode(mode);
  applyTopmanUiModeToDocument(mode);

  if (options.updateUrl !== false && typeof window !== 'undefined') {
    try {
      const next = writeTopmanUiModeToUrl(mode);
      window.history.replaceState(window.history.state, '', next.toString());
    } catch {
      // Ignore history failures (file:// / restricted).
    }
  }

  if (options.dispatch !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TOPMAN_UI_MODE_EVENT, { detail: { mode } }));
  }

  return mode;
}

export function initTopmanUiMode(): TopmanUiMode {
  const mode = resolveTopmanUiMode();
  applyTopmanUiModeToDocument(mode);
  // Persist resolved default so first-time users keep simple next visit.
  if (!storedTopmanUiMode() && !readTopmanUiModeFromUrl()) {
    saveTopmanUiMode(mode);
  }
  return mode;
}
