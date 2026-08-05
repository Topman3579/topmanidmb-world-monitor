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
  // receive the TOPMANIDMB default: Thai-only UI (specialist English terms stay as-is).
  try {
    if (localStorage.getItem(EXPLICIT_LOCALE_KEY) === 'en') return 'en';
  } catch {
    // Storage can be unavailable in private mode.
  }
  return 'th';
}

export function topmanText(thai: string, english: string): string {
  switch (getTopmanLanguageMode()) {
    case 'th': return thai;
    case 'en': return english;
    case 'bilingual': return `${thai} / ${english}`;
  }
}

/** Product line name — briefing desk for command, not a generic feed. */
export function getTopmanProductName(): string {
  return 'TOPMAN News Room';
}

/** Always-visible product promise under the name. */
export function getTopmanBrandSubtitle(): string {
  return topmanText('ภาพรวมสถานการณ์ · โฟกัสไทย', 'Situation overview · Thailand focus');
}

/** One-line role: collect → organize → analyze → present for national command. */
export function getTopmanProductMission(): string {
  return topmanText(
    'รวบรวม · เรียบเรียง · วิเคราะห์ · นำเสนอข้อมูล ให้ ผบ.ตร. และนายกรัฐมนตรี เพื่อเข้าใจข่าวสารและตัดสินใจ',
    'Collect, organize, analyze, and present information for the Royal Thai Police Commissioner and the Prime Minister — for news awareness and decision-making',
  );
}

/** Primary audience label for executive briefs and LINE messages. */
export function getTopmanBriefAudienceLabel(): string {
  return topmanText('ผบ.ตร. / นายกรัฐมนตรี', 'Royal Thai Police Commissioner / Prime Minister');
}

/** Formal LINE salutation for daily briefs. */
export function getTopmanBriefLineSalutation(): string {
  return topmanText('เรียน ผบ.ตร. / นายกรัฐมนตรี', 'Dear Commissioner / Prime Minister');
}

/** Short workflow tag for the simple shell kicker. */
export function getTopmanWorkflowTag(): string {
  return topmanText(
    'รวบรวม · เรียบเรียง · วิเคราะห์ · นำเสนอ',
    'Collect · organize · analyze · present',
  );
}

/** Entry CTA for welcome / simple mode. */
export function getTopmanOpenDeskLabel(): string {
  return topmanText('เปิด News Room', 'Open News Room');
}
