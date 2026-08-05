/**
 * TOPMAN News Room — daily executive brief (Thai, data-backed).
 * Pure helpers for API cron + client UI. Never invents security facts.
 */

export const TOPMAN_DAILY_BRIEF_KEY_PREFIX = 'topman:daily-brief:';
export const MAX_LINE_MESSAGE_CHARS = 1800;

/** @typedef {'draft' | 'approved' | 'sent'} TopmanBriefStatus */

/**
 * Calendar date key in Asia/Bangkok (YYYY-MM-DD).
 * @param {Date | number | string} [now]
 */
export function bangkokDateKey(now = Date.now()) {
  const d = new Date(now);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${day}`;
}

/**
 * Thai Buddhist-era long date for memo header.
 * @param {string} dateKey YYYY-MM-DD
 */
export function formatThaiOfficialDate(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const year = Number(m[1]) + 543;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const months = [
    '', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  return `${day} ${months[month] ?? month} ${year}`;
}

/**
 * Short Thai date for LINE (e.g. 4 ส.ค. 69)
 * @param {string} dateKey
 */
export function formatThaiShortDate(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const year = (Number(m[1]) + 543) % 100;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const months = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${day} ${months[month] ?? month} ${String(year).padStart(2, '0')}`;
}

export function briefRedisKey(dateKey) {
  return `${TOPMAN_DAILY_BRIEF_KEY_PREFIX}${dateKey}`;
}

function clip(text, maxChars) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 1).trim()}…`;
}

function storyText(story) {
  if (!story || typeof story !== 'object') return '';
  return [
    story.primaryTitle,
    story.summary,
    story.primarySource,
    story.category,
  ].filter((v) => typeof v === 'string').join(' ');
}

const DISASTER_RE = /flood|quake|earthquake|storm|typhoon|cyclone|wildfire|landslide|disaster|weather|alert|ฝน|น้ำท่วม|แผ่นดินไหว|พายุ|ภัย|อุตุ|ปภ/i;
const ENERGY_RE = /oil|gas|energy|opec|pipeline|fuel|diesel|gasoline|lng|พลังงาน|น้ำมัน|ดีเซล|แก๊ส/i;
const MARKET_RE = /market|stock|set|equity|bond|fed|ทอง|ตลาด|หุ้น|เศรษฐกิจ|baht|บาท/i;
const SECURITY_RE = /border|conflict|military|strike|attack|ceasefire|missile|ชายแดน|ปะทะ|ความมั่นคง|กองทัพ|หยุดยิง|กัมพูชา|เมียนมา/i;

/**
 * @param {unknown} insights
 * @returns {Array<Record<string, unknown>>}
 */
function topStories(insights) {
  if (!insights || typeof insights !== 'object') return [];
  const stories = /** @type {{ topStories?: unknown }} */ (insights).topStories;
  return Array.isArray(stories) ? stories.filter((s) => s && typeof s === 'object') : [];
}

/**
 * @param {Array<Record<string, unknown>>} stories
 * @param {RegExp} re
 */
function pickStories(stories, re, limit = 3) {
  return stories.filter((s) => re.test(storyText(s))).slice(0, limit);
}

/**
 * @param {Array<Record<string, unknown>>} stories
 */
function titlesLine(stories, emptyFallback) {
  const titles = stories
    .map((s) => (typeof s.primaryTitle === 'string' ? s.primaryTitle.trim() : ''))
    .filter(Boolean);
  if (titles.length === 0) return emptyFallback;
  return clip(titles.join(' · '), 320);
}

/**
 * Build a daily brief document from verified insights (+ optional simple cards).
 * @param {{
 *   insights?: unknown,
 *   cards?: Array<{ id?: string, title?: string, summary?: string, sources?: string[] }>,
 *   nowMs?: number,
 *   existing?: Record<string, unknown> | null,
 * }} input
 */
export function buildTopmanDailyBrief(input = {}) {
  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  const dateKey = bangkokDateKey(nowMs);
  const stories = topStories(input.insights);
  const worldBrief = input.insights && typeof input.insights === 'object'
    && typeof /** @type {{ worldBrief?: unknown }} */ (input.insights).worldBrief === 'string'
    ? clip(/** @type {{ worldBrief: string }} */ (input.insights).worldBrief, 360)
    : '';

  const cardById = new Map(
    (Array.isArray(input.cards) ? input.cards : [])
      .filter((c) => c && typeof c === 'object' && typeof c.id === 'string')
      .map((c) => [c.id, c]),
  );

  const securityStories = pickStories(stories, SECURITY_RE);
  const disasterStories = pickStories(stories, DISASTER_RE);
  const energyStories = pickStories(stories, ENERGY_RE);
  const marketStories = pickStories(stories, MARKET_RE);

  const aseanCard = cardById.get('asean');
  const watchCard = cardById.get('watch');
  const worldCard = cardById.get('world');

  const securityBody = securityStories.length > 0
    ? titlesLine(securityStories, '')
    : (aseanCard?.summary
      ? clip(aseanCard.summary, 320)
      : 'ในชุดข้อมูลที่ตรวจสอบได้รอบนี้ ยังไม่มีประเด็นความมั่นคงที่ระบุชัดพอจะสรุปเป็นการยืนยัน');

  const securityCaveat = securityStories.length === 0
    ? 'ต้องยืนยันจากช่องทางทางการ (เช่น ศบ.ทก. / กต. / มท.) ก่อนใช้ประกอบการสั่งการ'
    : 'สรุปจากหัวข้อข่าวที่จัดกลุ่มได้ — ยังไม่ใช่แถลงการณ์ทางการ';

  const disasterBody = disasterStories.length > 0
    ? titlesLine(disasterStories, '')
    : 'ในชุดข้อมูลรอบนี้ยังไม่พบประเด็นภัยพิบัติ/อากาศที่ระบุชัดในสรุปหลัก';

  const energyBody = energyStories.length > 0
    ? titlesLine(energyStories, '')
    : 'ในชุดข้อมูลรอบนี้ยังไม่พบประเด็นพลังงานที่ระบุชัดในสรุปหลัก';

  const marketsBody = marketStories.length > 0
    ? titlesLine(marketStories, '')
    : (worldBrief || (worldCard?.summary ? clip(worldCard.summary, 280) : 'ในชุดข้อมูลรอบนี้ยังไม่พบตัวเลขตลาดที่ระบุชัดในสรุปหลัก'));

  const sources = [];
  for (const story of [...securityStories, ...disasterStories, ...energyStories, ...marketStories].slice(0, 8)) {
    const src = typeof story.primarySource === 'string' ? story.primarySource.trim() : '';
    if (src && !sources.includes(src)) sources.push(src);
  }
  for (const card of [worldCard, aseanCard, watchCard]) {
    if (!card || !Array.isArray(card.sources)) continue;
    for (const src of card.sources) {
      if (typeof src === 'string' && src && !sources.includes(src)) sources.push(src);
    }
  }

  const facts = [];
  if (disasterStories.length) facts.push('ภัยพิบัติ/อากาศ: มีหัวข้อในชุดข่าวที่ตรวจสอบได้');
  if (energyStories.length) facts.push('พลังงาน: มีหัวข้อในชุดข่าวที่ตรวจสอบได้');
  if (marketStories.length || worldBrief) facts.push('ตลาด/ภาพรวม: มีข้อความสรุปจากแหล่งที่ระบบดึงมาได้');
  if (securityStories.length) facts.push('ความมั่นคง: มีหัวข้อข่าวที่เข้าข่าย — ยังต้องยืนยันทางการ');

  const gaps = [];
  if (!securityStories.length) {
    gaps.push('สถานะความมั่นคงชายแดน/ความขัดแย้ง — ใช้ได้เฉพาะระดับเฝ้าระวังจนกว่าจะมีแถลงการณ์ทางการ');
  }
  if (!disasterStories.length) gaps.push('ภัยพิบัติ — ไม่มีหัวข้อชัดในชุดสรุปรอบนี้');
  if (!energyStories.length) gaps.push('พลังงาน — ไม่มีหัวข้อชัดในชุดสรุปรอบนี้');
  if (!marketStories.length && !worldBrief) gaps.push('ตลาด — ไม่มีตัวเลขชัดในชุดสรุปรอบนี้');

  const followUps = [
    { item: 'ยืนยันประเด็นความมั่นคงจากช่องทางทางการที่เกี่ยวข้อง', reason: securityCaveat },
    { item: 'ติดตามประกาศเตือนภัยของ ปภ./กรมอุตุฯ', reason: 'ป้องกันน้ำท่วมฉับพลันและภัยอากาศ' },
    { item: 'เฝ้าพลังงานและราคาที่เกี่ยวข้องในประเทศ', reason: 'ปัจจัยต้นทุนและเส้นทางขนส่ง' },
    { item: 'ติดตาม SET และปัจจัยภายนอกที่กระทบตลาด', reason: 'ความผันผวนรายวัน' },
  ];

  const shortDate = formatThaiShortDate(dateKey);
  const lineMessage = [
    'เรียน ผบ.ตร. / นายกรัฐมนตรี',
    `สรุป 24 ชม. (${shortDate})`,
    '',
    `• ความมั่นคง: ${clip(securityBody, 160)} (${securityCaveat})`,
    `• ภัยพิบัติ: ${clip(disasterBody, 160)}`,
    `• พลังงาน: ${clip(energyBody, 140)}`,
    `• ตลาด: ${clip(marketsBody, 140)}`,
    '',
    'รายละเอียดฉบับเต็มอยู่ในบันทึกสรุปผู้บริหาร',
    'สถานะ: ร่างบรีฟภายใน — ยังไม่ใช่ข้อยุติทางการ',
  ].join('\n');

  const officialDate = formatThaiOfficialDate(dateKey);
  const memoMarkdown = [
    `# สรุปสถานการณ์รอบประเทศไทยและอาเซียน (รอบ 24 ชั่วโมง)`,
    '',
    `**เรื่อง** สรุปสถานการณ์รอบประเทศไทยและอาเซียน (รอบ 24 ชั่วโมง)`,
    `**วันที่** ${officialDate}`,
    `**จัดทำโดย** TOPMAN News Room`,
    `**ผู้รับ** ผบ.ตร. / นายกรัฐมนตรี`,
    `**สถานะ** ร่างบรีฟภายใน — ต้องตรวจก่อนส่ง LINE OA`,
    '',
    '### สาระสำคัญ',
    '',
    `1. **ความมั่นคง**  `,
    `   ${securityBody}  `,
    `   **ข้อจำกัด:** ${securityCaveat}`,
    '',
    `2. **ภัยพิบัติและอากาศ**  `,
    `   ${disasterBody}`,
    '',
    `3. **พลังงานและเส้นทาง**  `,
    `   ${energyBody}`,
    '',
    `4. **ตลาดและเศรษฐกิจ**  `,
    `   ${marketsBody}`,
    '',
    '### ข้อเสนอเพื่อการติดตาม',
    '',
    '| ลำดับ | รายการ | เหตุผล |',
    '|:---:|:---|:---|',
    ...followUps.map((f, i) => `| ${i + 1} | ${f.item} | ${f.reason} |`),
    '',
    '### การจำแนกข้อมูล',
    '',
    ...(facts.length ? facts.map((f) => `- **ข้อเท็จจริงจากร่างสรุป:** ${f}`) : ['- **ข้อเท็จจริงจากร่างสรุป:** ยังมีจำกัดในรอบนี้']),
    ...gaps.map((g) => `- **สมมติฐาน/ช่องว่าง:** ${g}`),
    '',
    sources.length
      ? `แหล่งที่อ้างในร่าง: ${sources.slice(0, 6).join(' · ')}`
      : 'แหล่งที่อ้างในร่าง: ยังระบุชื่อแหล่งไม่ครบ',
    '',
    '*sanitized brief · ไม่ใส่ PII/ข้อมูลคดี*',
  ].join('\n');

  const existing = input.existing && typeof input.existing === 'object' ? input.existing : null;
  const preserveStatus = existing
    && (existing.status === 'approved' || existing.status === 'sent')
    && existing.dateKey === dateKey;

  /** @type {Record<string, unknown>} */
  const brief = {
    version: 1,
    dateKey,
    status: preserveStatus ? existing.status : 'draft',
    createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    approvedAt: preserveStatus ? existing.approvedAt ?? null : null,
    sentAt: preserveStatus && existing.status === 'sent' ? existing.sentAt ?? null : null,
    lineMessage: preserveStatus && typeof existing.lineMessage === 'string'
      ? existing.lineMessage
      : clip(lineMessage, MAX_LINE_MESSAGE_CHARS),
    memoMarkdown: preserveStatus && typeof existing.memoMarkdown === 'string'
      ? existing.memoMarkdown
      : memoMarkdown,
    sections: {
      security: { body: securityBody, caveat: securityCaveat },
      disaster: { body: disasterBody, caveat: '' },
      energy: { body: energyBody, caveat: '' },
      markets: { body: marketsBody, caveat: '' },
    },
    followUps,
    facts,
    gaps,
    sources: sources.slice(0, 8),
    generatedFrom: [
      stories.length ? 'news:insights' : null,
      cardById.size ? 'simple-summary' : null,
    ].filter(Boolean),
  };

  return brief;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isTopmanDailyBrief(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof /** @type {{ dateKey?: unknown }} */ (value).dateKey === 'string'
    && typeof /** @type {{ lineMessage?: unknown }} */ (value).lineMessage === 'string'
    && typeof /** @type {{ memoMarkdown?: unknown }} */ (value).memoMarkdown === 'string',
  );
}

/**
 * @param {Record<string, unknown>} brief
 * @param {{ lineMessage?: string, memoMarkdown?: string, nowMs?: number }} patch
 */
export function patchTopmanDailyBrief(brief, patch = {}) {
  const nowMs = typeof patch.nowMs === 'number' ? patch.nowMs : Date.now();
  const next = { ...brief };
  if (typeof patch.lineMessage === 'string') {
    next.lineMessage = clip(patch.lineMessage, MAX_LINE_MESSAGE_CHARS);
  }
  if (typeof patch.memoMarkdown === 'string') {
    next.memoMarkdown = patch.memoMarkdown;
  }
  next.updatedAt = new Date(nowMs).toISOString();
  return next;
}

/**
 * @param {Record<string, unknown>} brief
 * @param {number} [nowMs]
 */
export function approveTopmanDailyBrief(brief, nowMs = Date.now()) {
  return {
    ...brief,
    status: 'approved',
    approvedAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * @param {Record<string, unknown>} brief
 * @param {number} [nowMs]
 */
export function markTopmanDailyBriefSent(brief, nowMs = Date.now()) {
  return {
    ...brief,
    status: 'sent',
    sentAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
  };
}
