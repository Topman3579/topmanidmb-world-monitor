/**
 * Builds Simple Mode executive cards from verified data only.
 * Never invents facts — missing data becomes an explicit unavailable/partial state.
 */

import type { ServerInsights, ServerInsightStory } from '@/services/insights-loader';
import type { TopmanHealthSnapshot, TopmanHealthState } from '@/services/topman-health-status';
import { topmanText } from '@/services/topman-language-mode';

export type SimpleSituationLevel = 'calm' | 'watch' | 'elevated' | 'critical' | 'unknown';

export type SimpleDataStatus = 'ready' | 'partial' | 'stale' | 'unavailable';

export interface SimpleSummaryCard {
  id: 'world' | 'asean' | 'watch';
  title: string;
  level: SimpleSituationLevel;
  levelLabel: string;
  summary: string;
  updatedAt: string | null;
  updatedLabel: string;
  sources: string[];
  detailHint: string;
  status: SimpleDataStatus;
}

export interface SimpleExecutiveSummary {
  headline: string;
  body: string;
  status: SimpleDataStatus;
  cards: SimpleSummaryCard[];
  generatedFrom: string[];
}

const ASEAN_CODES = new Set([
  'TH', 'MY', 'ID', 'SG', 'VN', 'PH', 'MM', 'KH', 'LA', 'BN', 'TL',
]);

const ASEAN_KEYWORDS = [
  'thailand', 'thai', 'asean', 'bangkok', 'myanmar', 'burma',
  'cambodia', 'laos', 'vietnam', 'malaysia', 'singapore',
  'indonesia', 'philippines', 'south china sea', 'malacca',
  'ไทย', 'อาเซียน', 'เมียนมา', 'กัมพูชา', 'เวียดนาม',
  'มาเลเซีย', 'สิงคโปร์', 'อินโดนีเซีย', 'ฟิลิปปินส์',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mapHealthToSimpleStatus(health: TopmanHealthSnapshot | null | undefined): SimpleDataStatus {
  if (!health) return 'unavailable';
  switch (health.state as TopmanHealthState) {
    case 'healthy':
      return 'ready';
    case 'partial':
      return 'partial';
    case 'stale':
      return 'stale';
    case 'unavailable':
    default:
      return 'unavailable';
  }
}

export function formatSimpleDataStatusLabel(status: SimpleDataStatus): string {
  switch (status) {
    case 'ready':
      return topmanText('พร้อม', 'Ready');
    case 'partial':
      return topmanText('พร้อมบางส่วน', 'Partially ready');
    case 'stale':
      return topmanText('ข้อมูลล่าช้า', 'Data delayed');
    case 'unavailable':
      return topmanText('ไม่สามารถตรวจสอบได้', 'Cannot verify');
  }
}

export function formatSituationLevelLabel(level: SimpleSituationLevel): string {
  switch (level) {
    case 'calm':
      return topmanText('สงบ', 'Calm');
    case 'watch':
      return topmanText('เฝ้าระวัง', 'Watch');
    case 'elevated':
      return topmanText('สูงขึ้น', 'Elevated');
    case 'critical':
      return topmanText('วิกฤต', 'Critical');
    case 'unknown':
      return topmanText('ยังไม่ทราบ', 'Unknown');
  }
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return topmanText('ยังไม่มีเวลาอัปเดต', 'No update time');
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return topmanText('ยังไม่มีเวลาอัปเดต', 'No update time');
  try {
    return topmanText(
      `อัปเดต ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(ms)}`,
      `Updated ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(ms)}`,
    );
  } catch {
    return topmanText(`อัปเดต ${new Date(ms).toISOString()}`, `Updated ${new Date(ms).toISOString()}`);
  }
}

function storyTouchesAsean(story: ServerInsightStory): boolean {
  if (story.countryCode && ASEAN_CODES.has(story.countryCode.toUpperCase())) return true;
  const hay = `${story.primaryTitle} ${story.primarySource} ${story.category}`.toLowerCase();
  return ASEAN_KEYWORDS.some((kw) => hay.includes(kw));
}

function threatToLevel(threat: string | undefined, isAlert: boolean): SimpleSituationLevel {
  const t = (threat || '').toLowerCase();
  if (isAlert || t === 'critical' || t === 'severe' || t === 'extreme') return 'critical';
  if (t === 'high' || t === 'elevated') return 'elevated';
  if (t === 'medium' || t === 'moderate' || t === 'watch') return 'watch';
  if (t === 'low' || t === 'calm' || t === 'info') return 'calm';
  return isAlert ? 'elevated' : 'watch';
}

function maxLevel(levels: SimpleSituationLevel[]): SimpleSituationLevel {
  const rank: Record<SimpleSituationLevel, number> = {
    unknown: 0,
    calm: 1,
    watch: 2,
    elevated: 3,
    critical: 4,
  };
  let best: SimpleSituationLevel = 'unknown';
  for (const level of levels) {
    if (rank[level] > rank[best]) best = level;
  }
  return best;
}

function clipSentences(text: string, maxSentences = 3, maxChars = 420): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const parts = cleaned.split(/(?<=[.!?。])\s+/).filter(Boolean);
  let out = parts.slice(0, maxSentences).join(' ');
  if (out.length > maxChars) {
    out = `${out.slice(0, maxChars - 1).trim()}…`;
  }
  return out;
}

function uniqueSources(stories: ServerInsightStory[], limit = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const story of stories) {
    const name = (story.primarySource || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

function emptyCard(
  id: SimpleSummaryCard['id'],
  title: string,
  reason: string,
  status: SimpleDataStatus,
): SimpleSummaryCard {
  return {
    id,
    title,
    level: 'unknown',
    levelLabel: formatSituationLevelLabel('unknown'),
    summary: reason,
    updatedAt: null,
    updatedLabel: formatUpdatedAt(null),
    sources: [],
    detailHint: topmanText('ดูรายละเอียดเมื่อมีข้อมูล', 'Details when data is available'),
    status,
  };
}

/**
 * Pure builder — pass only validated insights + health snapshot.
 * Does not fetch; callers own transport failures.
 */
export function buildSimpleExecutiveSummary(input: {
  insights: ServerInsights | null;
  health: TopmanHealthSnapshot | null;
  nowMs?: number;
}): SimpleExecutiveSummary {
  const healthStatus = mapHealthToSimpleStatus(input.health);
  const insights = input.insights;
  const generatedFrom: string[] = [];

  if (!insights) {
    const reason = topmanText(
      'ยังไม่มีสรุปสถานการณ์จากแหล่งที่ตรวจสอบได้ในขณะนี้ ระบบจะไม่เดาข้อเท็จจริงให้',
      'No verified situation summary is available right now. The system will not invent facts.',
    );
    const status: SimpleDataStatus = healthStatus === 'ready' ? 'partial' : healthStatus;
    return {
      headline: topmanText('วันนี้ยังสรุปภาพรวมไม่ได้ครบ', 'Full summary not available today'),
      body: reason,
      status,
      cards: [
        emptyCard('world', topmanText('โลกวันนี้', 'World today'), reason, status),
        emptyCard('asean', topmanText('ผลกระทบต่อไทยและอาเซียน', 'Impact on Thailand & ASEAN'), reason, status),
        emptyCard('watch', topmanText('สิ่งที่ต้องจับตา', 'What to watch'), reason, status),
      ],
      generatedFrom: input.health ? ['topman-core-status'] : [],
    };
  }

  generatedFrom.push('server-insights');
  if (input.health) generatedFrom.push('topman-core-status');

  const stories = Array.isArray(insights.topStories) ? insights.topStories : [];
  const brief = typeof insights.worldBrief === 'string' ? clipSentences(insights.worldBrief) : '';
  const updatedAt = typeof insights.generatedAt === 'string' ? insights.generatedAt : null;

  // World card
  const worldLevels = stories.slice(0, 5).map((s) => threatToLevel(s.threatLevel, s.isAlert));
  const worldLevel = stories.length === 0
    ? (brief ? 'watch' : 'unknown')
    : maxLevel(worldLevels);
  const worldSummary = brief
    || (stories[0]
      ? clipSentences(stories[0]!.primaryTitle, 2, 280)
      : topmanText('มีข้อมูลข่าว แต่ยังไม่มีบทสรุปสั้น', 'News is present, but no short brief yet'));
  const worldSources = [
    ...uniqueSources(stories.slice(0, 5)),
    ...(insights.worldBriefSources ?? []).map((s) => s.source).filter(Boolean).slice(0, 2),
  ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 4);

  const worldStatus: SimpleDataStatus =
    insights.status === 'degraded' || healthStatus === 'partial' || healthStatus === 'stale'
      ? (healthStatus === 'stale' ? 'stale' : 'partial')
      : healthStatus === 'unavailable'
        ? 'partial'
        : 'ready';

  const worldCard: SimpleSummaryCard = {
    id: 'world',
    title: topmanText('โลกวันนี้', 'World today'),
    level: worldLevel,
    levelLabel: formatSituationLevelLabel(worldLevel),
    summary: worldSummary,
    updatedAt,
    updatedLabel: formatUpdatedAt(updatedAt),
    sources: worldSources.length > 0 ? worldSources : [topmanText('สรุปข่าวรวม', 'Aggregated brief')],
    detailHint: topmanText('ดูรายละเอียดในโหมดผู้เชี่ยวชาญ', 'Open details in Advanced Mode'),
    status: worldStatus,
  };

  // ASEAN card — only from stories that match ASEAN codes/keywords
  const aseanStories = stories.filter(storyTouchesAsean);
  let aseanCard: SimpleSummaryCard;
  if (aseanStories.length === 0) {
    aseanCard = emptyCard(
      'asean',
      topmanText('ผลกระทบต่อไทยและอาเซียน', 'Impact on Thailand & ASEAN'),
      topmanText(
        'ในชุดข่าวล่าสุดที่ตรวจสอบได้ ยังไม่พบประเด็นที่ระบุชัดว่าเกี่ยวกับไทยหรืออาเซียน — ไม่ได้หมายความว่าไม่มีเหตุการณ์ แค่ยังไม่ถูกจัดอยู่ในสรุปนี้',
        'In the latest verified headline set, no items clearly mark Thailand or ASEAN. That does not prove calm — only that none are in this summary.',
      ),
      worldStatus === 'ready' ? 'partial' : worldStatus,
    );
    aseanCard.updatedAt = updatedAt;
    aseanCard.updatedLabel = formatUpdatedAt(updatedAt);
  } else {
    const level = maxLevel(aseanStories.map((s) => threatToLevel(s.threatLevel, s.isAlert)));
    const lines = aseanStories.slice(0, 3).map((s) => s.primaryTitle.trim()).filter(Boolean);
    aseanCard = {
      id: 'asean',
      title: topmanText('ผลกระทบต่อไทยและอาเซียน', 'Impact on Thailand & ASEAN'),
      level,
      levelLabel: formatSituationLevelLabel(level),
      summary: clipSentences(lines.join('. '), 3, 360),
      updatedAt,
      updatedLabel: formatUpdatedAt(updatedAt),
      sources: uniqueSources(aseanStories),
      detailHint: topmanText('ดูภารกิจไทยและอาเซียน', 'Open Thailand & ASEAN mission'),
      status: worldStatus,
    };
  }

  // Watch card — alerts / multi-source / high importance only
  const watchStories = stories
    .filter((s) => s.isAlert || s.sourceCount >= 3 || (typeof s.importanceScore === 'number' && s.importanceScore >= 0.7))
    .slice(0, 5);
  let watchCard: SimpleSummaryCard;
  if (watchStories.length === 0) {
    watchCard = emptyCard(
      'watch',
      topmanText('สิ่งที่ต้องจับตา', 'What to watch'),
      topmanText(
        'ยังไม่มีรายการแจ้งเตือนหรือข่าวหลายแหล่งในชุดล่าสุดที่ต้องจับตาเป็นพิเศษ',
        'No multi-source alerts in the latest set that require special watch.',
      ),
      worldStatus,
    );
    watchCard.level = 'calm';
    watchCard.levelLabel = formatSituationLevelLabel('calm');
    watchCard.updatedAt = updatedAt;
    watchCard.updatedLabel = formatUpdatedAt(updatedAt);
  } else {
    const level = maxLevel(watchStories.map((s) => threatToLevel(s.threatLevel, s.isAlert)));
    watchCard = {
      id: 'watch',
      title: topmanText('สิ่งที่ต้องจับตา', 'What to watch'),
      level,
      levelLabel: formatSituationLevelLabel(level),
      summary: clipSentences(
        watchStories.map((s) => s.primaryTitle.trim()).filter(Boolean).join('. '),
        3,
        360,
      ),
      updatedAt,
      updatedLabel: formatUpdatedAt(updatedAt),
      sources: uniqueSources(watchStories),
      detailHint: topmanText('ดูรายละเอียดในโหมดผู้เชี่ยวชาญ', 'Open details in Advanced Mode'),
      status: worldStatus,
    };
  }

  const overallLevel = maxLevel([worldCard.level, aseanCard.level, watchCard.level].filter((l) => l !== 'unknown') as SimpleSituationLevel[]);
  const headline = overallLevel === 'critical'
    ? topmanText('วันนี้มีประเด็นวิกฤตที่ควรรู้', 'Critical issues to know today')
    : overallLevel === 'elevated'
      ? topmanText('วันนี้มีประเด็นสำคัญที่ควรติดตาม', 'Important issues to follow today')
      : overallLevel === 'watch'
        ? topmanText('วันนี้ควรรู้อะไร', 'What to know today')
        : topmanText('ภาพรวมวันนี้', 'Today at a glance');

  const bodyParts = [
    brief || worldCard.summary,
    aseanStories.length > 0
      ? topmanText(
        `ไทย/อาเซียน: พบ ${aseanStories.length} ประเด็นในชุดข่าวล่าสุด`,
        `Thailand/ASEAN: ${aseanStories.length} items in the latest set`,
      )
      : topmanText('ไทย/อาเซียน: ยังไม่พบประเด็นชัดในชุดสรุปล่าสุด', 'Thailand/ASEAN: no clear items in the latest brief set'),
    watchStories.length > 0
      ? topmanText(`จับตา: ${watchStories.length} รายการ`, `Watch: ${watchStories.length} items`)
      : null,
  ].filter(Boolean);

  // If core health is UNHEALTHY/partial/stale/unavailable, never claim overall ready.
  let overallStatus: SimpleDataStatus = worldStatus;
  if (healthStatus === 'partial' || healthStatus === 'stale' || healthStatus === 'unavailable') {
    overallStatus = healthStatus;
  }

  return {
    headline,
    body: clipSentences(bodyParts.join(' · '), 4, 480),
    status: overallStatus,
    cards: [worldCard, aseanCard, watchCard],
    generatedFrom,
  };
}

/** Guard against accidental AI-hallucinated free text in unit tests / future LLM hooks. */
export function assertSummaryIsDataBacked(summary: SimpleExecutiveSummary): boolean {
  if (!isObject(summary)) return false;
  if (!Array.isArray(summary.cards) || summary.cards.length !== 3) return false;
  if (summary.generatedFrom.length === 0 && summary.status === 'ready') return false;
  return summary.cards.every((card) => typeof card.summary === 'string' && card.summary.length > 0);
}
