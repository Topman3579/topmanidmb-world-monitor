const EXPLICIT_LOCALE_KEY = 'wm-locale-explicit';
export const TOPMAN_LANGUAGE_MODE_KEY = 'topman-language-mode';

export type TopmanLanguageMode = 'th' | 'bilingual' | 'en';

const TOPMAN_LANGUAGE_MODES = new Set<TopmanLanguageMode>(['th', 'bilingual', 'en']);

function normalizeTopmanLanguageMode(value: string | null | undefined): TopmanLanguageMode | null {
  return value && TOPMAN_LANGUAGE_MODES.has(value as TopmanLanguageMode)
    ? value as TopmanLanguageMode
    : null;
}

export function readRequestedTopmanLanguageModeFromUrl(): TopmanLanguageMode | null {
  if (typeof window === 'undefined') return null;
  try {
    return normalizeTopmanLanguageMode(new URL(window.location.href).searchParams.get('topmanMode'));
  } catch {
    return null;
  }
}

export function storedTopmanLanguageMode(): TopmanLanguageMode | null {
  try {
    return normalizeTopmanLanguageMode(localStorage.getItem(TOPMAN_LANGUAGE_MODE_KEY));
  } catch {
    return null;
  }
}

export function getTopmanLanguageMode(): TopmanLanguageMode {
  const requested = readRequestedTopmanLanguageModeFromUrl();
  if (requested) return requested;

  const stored = storedTopmanLanguageMode();
  if (stored) return stored;

  // Keep a prior explicit English selection intact. Thai and first-time users
  // receive the TOPMANIDMB default: Thai-first with short English guidance.
  try {
    if (localStorage.getItem(EXPLICIT_LOCALE_KEY) === 'en') return 'en';
  } catch {
    // Storage can be unavailable in private mode.
  }
  return 'bilingual';
}

export function topmanText(thai: string, english: string): string {
  switch (getTopmanLanguageMode()) {
    case 'th': return thai;
    case 'en': return english;
    case 'bilingual': return `${thai} / ${english}`;
  }
}

export function getTopmanBrandSubtitle(): string {
  return topmanText('ข่าวกรองสถานการณ์โลก', 'World Intelligence');
}
