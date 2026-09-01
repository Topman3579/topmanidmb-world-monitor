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

const ASEAN_PLACE_RE = /thailand|myanmar|burma|laos|cambodia|vietnam|malaysia|singapore|indonesia|philippines|andaman|sumatra|java|sulawesi|aceh|bangkok|chiang|phuket|malacca|south china|thai|ไทย|เมียนมา|ลาว|กัมพูชา|เวียดนาม|มาเลเซีย|สิงคโปร์|อินโดนีเซีย|ฟิลิปปินส์|มะละกา/i;

function asRecordList(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
  if (!value || typeof value !== 'object') return [];
  const root = /** @type {Record<string, unknown>} */ (value);
  if (Array.isArray(root.earthquakes)) return asRecordList(root.earthquakes);
  if (Array.isArray(root.alerts)) return asRecordList(root.alerts);
  if (Array.isArray(root.events)) return asRecordList(root.events);
  if (Array.isArray(root.items)) return asRecordList(root.items);
  if (Array.isArray(root.quotes)) return asRecordList(root.quotes);
  if (Array.isArray(root.rates)) return asRecordList(root.rates);
  if (Array.isArray(root.articles)) return asRecordList(root.articles);
  if (Array.isArray(root.topics)) {
    return root.topics.flatMap((topic) => asRecordList(topic));
  }
  return [];
}

function firstBagValue(bag, ...keys) {
  for (const key of keys) {
    if (bag[key] != null) return bag[key];
  }
  return null;
}

function formatSignedPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function formatSignedNumber(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}`;
}

/**
 * Turn TOPMAN Core 6 payloads into Thai section fallbacks.
 * Never invents security certainty. US weather alerts are labeled as foreign.
 * @param {unknown} core
 */
export function summarizeTopmanCoreForBrief(core) {
  const empty = { security: '', disaster: '', energy: '', markets: '', sources: [], used: [] };
  if (!core || typeof core !== 'object') return empty;

  const bag = /** @type {Record<string, unknown>} */ (core);
  const sources = [];
  const used = [];

  const quakes = asRecordList(firstBagValue(bag, 'earthquakes')).map((item) => {
    const mag = Number(item.magnitude);
    const place = String(item.place || item.title || '').trim();
    return {
      mag,
      place,
      asean: ASEAN_PLACE_RE.test(place),
    };
  }).filter((item) => Number.isFinite(item.mag) && item.place && (item.asean ? item.mag >= 4.5 : item.mag >= 6));
  quakes.sort((a, b) => Number(b.asean) - Number(a.asean) || b.mag - a.mag);
  const quakeTop = quakes.slice(0, 3);
  let disaster = '';
  if (quakeTop.length) {
    disaster = quakeTop.map((item) => (
      `แผ่นดินไหว M${item.mag.toFixed(1)} ${item.place}${item.asean ? ' (ใกล้ไทย/อาเซียน)' : ''}`
    )).join(' · ');
    sources.push('USGS');
    used.push('earthquakes');
  }

  const events = asRecordList(firstBagValue(bag, 'naturalEvents', 'natural-events'))
    .map((item) => String(item.title || item.categoryTitle || '').trim())
    .filter((title) => title && (ASEAN_PLACE_RE.test(title) || /storm|volcano|wildfire|cyclone|typhoon|flood/i.test(title)))
    .slice(0, 2);
  if (events.length) {
    disaster = disaster ? `${disaster} · ${events.join(' · ')}` : events.join(' · ');
    sources.push('EONET');
    used.push('natural-events');
  }

  const weather = asRecordList(firstBagValue(bag, 'weatherAlerts', 'weather-alerts'));
  const thaiWeather = weather.filter((item) => ASEAN_PLACE_RE.test(String(`${item.headline || ''} ${item.areaDesc || ''} ${item.event || ''}`)));
  if (thaiWeather.length) {
    const line = thaiWeather.slice(0, 2).map((item) => String(item.headline || item.event || '').trim()).filter(Boolean).join(' · ');
    if (line) disaster = disaster ? `${disaster} · ${line}` : line;
    sources.push('NWS');
    used.push('weather-alerts');
  } else if (weather.length && !disaster) {
    disaster = `มีประกาศเตือนอากาศต่างประเทศ ${weather.length} รายการ (ชุดหลักเป็น NWS) — ยังไม่ใช่ประกาศ ปภ./กรมอุตุฯ ของไทย`;
    sources.push('NWS');
    used.push('weather-alerts');
  }

  const quotes = asRecordList(firstBagValue(bag, 'commodities', 'commodityQuotes'));
  const pickQuote = (...names) => quotes.find((item) => names.includes(String(item.display || item.name || '')));
  const energyBits = [];
  for (const quote of [pickQuote('OIL', 'Crude Oil WTI'), pickQuote('BRENT', 'Brent Crude'), pickQuote('NATGAS', 'Natural Gas')]) {
    if (!quote || !Number.isFinite(Number(quote.price))) continue;
    const label = quote.display === 'OIL' || quote.name === 'Crude Oil WTI' ? 'WTI' : quote.display === 'BRENT' || quote.name === 'Brent Crude' ? 'Brent' : 'ก๊าซธรรมชาติ';
    const pct = formatSignedPercent(quote.change);
    energyBits.push(`${label} ${Number(quote.price).toFixed(2)}${pct ? ` (${pct})` : ''}`);
  }
  const energy = energyBits.length ? `ราคาน้ำมัน/ก๊าซโลก: ${energyBits.join(' · ')} — ยังไม่ใช่ราคาขายปลีกในประเทศ` : '';
  if (energy) {
    sources.push('Yahoo Finance');
    used.push('commodities');
  }

  const gold = pickQuote('GOLD', 'Gold');
  const fxList = asRecordList(firstBagValue(bag, 'fxRates', 'ecbFxRates'));
  const thb = fxList.find((item) => /THB/i.test(String(item.pair || '')));
  const usd = fxList.find((item) => String(item.pair || '') === 'EURUSD');
  const fx = thb || usd;
  const marketBits = [];
  if (gold && Number.isFinite(Number(gold.price))) {
    const pct = formatSignedPercent(gold.change);
    marketBits.push(`ทองคำ ${Number(gold.price).toFixed(2)} ดอลลาร์/ออนซ์${pct ? ` (${pct})` : ''}`);
  }
  if (fx && Number.isFinite(Number(fx.rate))) {
    const delta = formatSignedNumber(fx.change1d, 4);
    const pairLabel = /THB/i.test(String(fx.pair || '')) ? `${fx.pair} (ECB)` : String(fx.pair);
    marketBits.push(`${pairLabel} ${Number(fx.rate).toFixed(4)}${delta ? ` (${delta})` : ''}`);
  }
  const markets = marketBits.length
    ? `${marketBits.join(' · ')} — ยังไม่มีตัวเลข SET ในชุด Core นี้`
    : '';
  if (gold) used.push('commodities');
  if (fx) {
    sources.push('ECB');
    used.push('fx-rates');
  }

  const gdelt = asRecordList(firstBagValue(bag, 'gdeltIntel', 'gdelt-intel'))
    .map((item) => String(item.title || '').trim())
    .filter((title) => title && (ASEAN_PLACE_RE.test(title) || SECURITY_RE.test(title)))
    .slice(0, 2);
  const security = gdelt.length
    ? `หัวข้อข่าวเปิดที่เข้าข่าย: ${gdelt.join(' · ')}`
    : '';
  if (gdelt.length) {
    sources.push('GDELT');
    used.push('gdelt-intel');
  }

  return {
    security: clip(security, 320),
    disaster: clip(disaster, 360),
    energy: clip(energy, 280),
    markets: clip(markets, 280),
    sources: [...new Set(sources)],
    used: [...new Set(used)],
  };
}

/**
 * Build a daily brief document from verified insights (+ optional simple cards).
 * @param {{
 *   insights?: unknown,
 *   core?: unknown,
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
  const coreSummary = summarizeTopmanCoreForBrief(input.core);

  const securityBody = securityStories.length > 0
    ? titlesLine(securityStories, '')
    : (coreSummary.security
      || (aseanCard?.summary ? clip(aseanCard.summary, 320) : '')
      || 'ในชุดข้อมูลที่ตรวจสอบได้รอบนี้ ยังไม่มีประเด็นความมั่นคงที่ระบุชัดพอจะสรุปเป็นการยืนยัน');

  const securityCaveat = securityStories.length === 0
    ? 'ต้องยืนยันจากช่องทางทางการ (เช่น ศบ.ทก. / กต. / มท.) ก่อนใช้ประกอบการสั่งการ'
    : 'สรุปจากหัวข้อข่าวที่จัดกลุ่มได้ — ยังไม่ใช่แถลงการณ์ทางการ';

  const disasterBody = disasterStories.length > 0
    ? titlesLine(disasterStories, '')
    : (coreSummary.disaster || 'ในชุดข้อมูลรอบนี้ยังไม่พบประเด็นภัยพิบัติ/อากาศที่ระบุชัดในสรุปหลัก');

  const energyBody = energyStories.length > 0
    ? titlesLine(energyStories, '')
    : (coreSummary.energy || 'ในชุดข้อมูลรอบนี้ยังไม่พบประเด็นพลังงานที่ระบุชัดในสรุปหลัก');

  const marketsBody = marketStories.length > 0
    ? titlesLine(marketStories, '')
    : (worldBrief
      || (worldCard?.summary ? clip(worldCard.summary, 280) : '')
      || coreSummary.markets
      || 'ในชุดข้อมูลรอบนี้ยังไม่พบตัวเลขตลาดที่ระบุชัดในสรุปหลัก');

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
  for (const src of coreSummary.sources) {
    if (src && !sources.includes(src)) sources.push(src);
  }

  const facts = [];
  if (disasterStories.length || coreSummary.disaster) facts.push('ภัยพิบัติ/อากาศ: มีหัวข้อหรือตัวเลขจากแหล่งที่ตรวจสอบได้');
  if (energyStories.length || coreSummary.energy) facts.push('พลังงาน: มีหัวข้อหรือราคาน้ำมันโลกจากแหล่งที่ตรวจสอบได้');
  if (marketStories.length || worldBrief || coreSummary.markets) facts.push('ตลาด/ภาพรวม: มีข้อความสรุปหรือราคาเปิดจากแหล่งที่ระบบดึงมาได้');
  if (securityStories.length || coreSummary.security) facts.push('ความมั่นคง: มีหัวข้อข่าวที่เข้าข่าย — ยังต้องยืนยันทางการ');

  const gaps = [];
  if (!securityStories.length) {
    gaps.push('สถานะความมั่นคงชายแดน/ความขัดแย้ง — ใช้ได้เฉพาะระดับเฝ้าระวังจนกว่าจะมีแถลงการณ์ทางการ');
  }
  if (!disasterStories.length && !coreSummary.disaster) gaps.push('ภัยพิบัติ — ไม่มีหัวข้อชัดในชุดสรุปรอบนี้');
  if (!energyStories.length && !coreSummary.energy) gaps.push('พลังงาน — ไม่มีหัวข้อชัดในชุดสรุปรอบนี้');
  if (!marketStories.length && !worldBrief && !coreSummary.markets) gaps.push('ตลาด — ไม่มีตัวเลขชัดในชุดสรุปรอบนี้');

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
      ...coreSummary.used.map((id) => `topman-core:${id}`),
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
