import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  approveTopmanDailyBrief,
  bangkokDateKey,
  buildTopmanDailyBrief,
  formatThaiOfficialDate,
  formatThaiShortDate,
  isTopmanDailyBrief,
  markTopmanDailyBriefSent,
  MAX_LINE_MESSAGE_CHARS,
  patchTopmanDailyBrief,
  summarizeTopmanCoreForBrief,
} from '../shared/topman-daily-brief.js';
import {
  approveTopmanDailyBrief as approveLocalTopmanDailyBrief,
  buildTopmanDailyBriefFromSummary,
  generateLocalTopmanDailyBrief,
  markTopmanDailyBriefSent as markLocalTopmanDailyBriefSent,
} from '../src/services/topman-daily-brief.ts';

describe('TOPMAN daily executive brief', () => {
  it('registers the authenticated 07:30 Bangkok draft cron', () => {
    const vercelConfig = JSON.parse(readFileSync(
      fileURLToPath(new URL('../vercel.json', import.meta.url)),
      'utf8',
    )) as { crons?: Array<{ path: string; schedule: string }> };
    assert.ok(vercelConfig.crons?.some((cron) =>
      cron.path === '/api/topman-daily-brief-generate' && cron.schedule === '30 0 * * *',
    ));
    const generateSrc = readFileSync(
      fileURLToPath(new URL('../api/topman-daily-brief-generate.ts', import.meta.url)),
      'utf8',
    );
    const briefApiSrc = readFileSync(
      fileURLToPath(new URL('../api/topman-daily-brief.ts', import.meta.url)),
      'utf8',
    );
    assert.match(generateSrc, /loadTopmanCoreForBrief/);
    assert.match(briefApiSrc, /loadTopmanCoreForBrief/);
    assert.match(generateSrc, /generatedFrom: brief\.generatedFrom/);
  });

  it('builds Bangkok date keys and Thai official dates', () => {
    const key = bangkokDateKey(Date.parse('2026-08-04T00:30:00.000Z')); // 07:30 ICT
    assert.equal(key, '2026-08-04');
    assert.match(formatThaiOfficialDate(key), /4 สิงหาคม 2569/);
    assert.match(formatThaiShortDate(key), /4 ส\.ค\. 69/);
  });

  it('builds a Thai LINE + memo brief without inventing security certainty', () => {
    const brief = buildTopmanDailyBrief({
      nowMs: Date.parse('2026-08-04T00:30:00.000Z'),
      insights: {
        worldBrief: 'Markets firmed as energy prices eased overnight.',
        topStories: [
          {
            primaryTitle: 'กรมอุตุฯเตือนฝนหนักหลายจังหวัด',
            primarySource: 'Thai PBS',
            category: 'disaster',
            isAlert: true,
          },
          {
            primaryTitle: 'SET closes higher on foreign inflows',
            primarySource: 'SET',
            category: 'markets',
          },
        ],
      },
      cards: [
        {
          id: 'asean',
          summary: 'ในชุดข่าวล่าสุดยังไม่พบประเด็นชายแดนที่ระบุชัด',
          sources: ['สรุปข่าวรวม'],
        },
      ],
    });

    assert.equal(isTopmanDailyBrief(brief), true);
    assert.equal(brief.status, 'draft');
    assert.equal(brief.dateKey, '2026-08-04');
    assert.match(String(brief.lineMessage), /เรียน ผบ\.ตร\. \/ นายกรัฐมนตรี/);
    assert.match(String(brief.lineMessage), /ความมั่นคง/);
    assert.match(String(brief.lineMessage), /ต้องยืนยันจากช่องทางทางการ/);
    assert.match(String(brief.memoMarkdown), /บันทึก|สรุปสถานการณ์|ข้อเสนอเพื่อการติดตาม/);
    assert.match(String(brief.memoMarkdown), /ศบ\.ทก\./);
    assert.ok(String(brief.lineMessage).length <= MAX_LINE_MESSAGE_CHARS);
    assert.ok(Array.isArray(brief.gaps));
    assert.ok((brief.gaps as string[]).some((g) => /ความมั่นคง|ชายแดน/.test(g)));
  });

  it('does not overwrite approved briefs on regenerate', () => {
    const approved = approveTopmanDailyBrief(buildTopmanDailyBrief({
      nowMs: Date.parse('2026-08-04T00:30:00.000Z'),
      insights: { topStories: [] },
    }));
    const again = buildTopmanDailyBrief({
      nowMs: Date.parse('2026-08-04T01:00:00.000Z'),
      insights: {
        topStories: [{ primaryTitle: 'New flood alert', primarySource: 'DDPM' }],
      },
      existing: approved,
    });
    assert.equal(again.status, 'approved');
    assert.equal(again.lineMessage, approved.lineMessage);
  });

  it('does not create or persist a replacement draft for an approved or sent local brief', () => {
    const draft = buildTopmanDailyBriefFromSummary({
      summary: null,
      nowMs: Date.parse('2026-08-04T00:30:00.000Z'),
    });
    const approved = approveLocalTopmanDailyBrief(draft, Date.parse('2026-08-04T00:45:00.000Z'));
    const sent = markLocalTopmanDailyBriefSent(approved, Date.parse('2026-08-04T00:50:00.000Z'));

    for (const locked of [approved, sent]) {
      const result = generateLocalTopmanDailyBrief({
        summary: null,
        existing: locked,
        nowMs: Date.parse('2026-08-04T01:00:00.000Z'),
      });
      assert.equal(result.generated, false);
      assert.strictEqual(result.brief, locked);
      assert.equal(result.brief.status, locked.status);
      assert.equal(result.brief.lineMessage, locked.lineMessage);
    }
  });

  it('starts a fresh draft when the locked local brief belongs to a prior Bangkok day', () => {
    const priorDraft = buildTopmanDailyBriefFromSummary({
      summary: null,
      nowMs: Date.parse('2026-08-04T00:30:00.000Z'),
    });
    const priorApproved = approveLocalTopmanDailyBrief(priorDraft, Date.parse('2026-08-04T00:45:00.000Z'));
    const nextDayMs = Date.parse('2026-08-05T00:30:00.000Z');

    const result = generateLocalTopmanDailyBrief({
      summary: null,
      existing: priorApproved,
      nowMs: nextDayMs,
    });

    assert.equal(result.generated, true);
    assert.equal(result.brief.dateKey, '2026-08-05');
    assert.equal(result.brief.status, 'draft');
    assert.equal(result.brief.createdAt, new Date(nextDayMs).toISOString());
  });

  it('fills empty insight sections from Core 6 without inventing a no-clash claim', () => {
    const nowMs = Date.parse('2026-09-01T00:30:00.000Z');
    const core = {
      earthquakes: {
        earthquakes: [
          { place: '96 km W of Palu, Indonesia', magnitude: 5.2, occurredAt: nowMs - 2 * 60 * 60 * 1000 },
          { place: '15 km E of Ridgecrest, CA', magnitude: 6.4, occurredAt: nowMs - 8 * 24 * 60 * 60 * 1000 },
        ],
      },
      weatherAlerts: {
        alerts: [
          { headline: 'Flood Warning issued for Texas', event: 'Flood Warning', areaDesc: 'Texas' },
        ],
      },
      naturalEvents: {
        events: [
          { title: 'Typhoon near Philippines', categoryTitle: 'Severe Storms' },
          { title: 'Tropical Storm Edouard', categoryTitle: 'Severe Storms' },
        ],
      },
      commodityQuotes: {
        quotes: [
          { display: 'OIL', name: 'Crude Oil WTI', price: 78.12, change: -0.45 },
          { display: 'BRENT', name: 'Brent Crude', price: 82.01, change: 0.22 },
          { display: 'NATGAS', name: 'Natural Gas', price: 2.31, change: 1.1 },
          { display: 'GOLD', name: 'Gold', price: 2480.5, change: 0.35 },
        ],
      },
      ecbFxRates: {
        rates: [
          { pair: 'EURTHB', rate: 37.12, change1d: 0.08 },
          { pair: 'EURUSD', rate: 1.085, change1d: -0.002 },
        ],
      },
      gdeltIntel: {
        topics: [
          { articles: [{ title: 'Thailand and Cambodia hold border talks' }] },
        ],
      },
    };

    const summary = summarizeTopmanCoreForBrief(core, nowMs);
    assert.match(summary.disaster, /M5\.2/);
    assert.match(summary.disaster, /Indonesia/);
    assert.match(summary.disaster, /Typhoon near Philippines/);
    assert.doesNotMatch(summary.disaster, /Ridgecrest/);
    assert.doesNotMatch(summary.disaster, /Edouard/);
    assert.doesNotMatch(summary.disaster, /Texas/);
    assert.match(summary.energy, /WTI 78\.12/);
    assert.match(summary.energy, /ยังไม่ใช่ราคาขายปลีกในประเทศ/);
    assert.match(summary.markets, /EURTHB/);
    assert.match(summary.markets, /\+0\.0800/);
    assert.doesNotMatch(summary.markets, /\+0\.08%/);
    assert.match(summary.security, /Thailand and Cambodia hold border talks/);
    assert.ok(summary.used.includes('earthquakes'));
    assert.ok(summary.used.includes('commodities'));

    const brief = buildTopmanDailyBrief({
      nowMs,
      insights: { topStories: [] },
      core,
    });

    assert.equal(brief.status, 'draft');
    assert.match(String(brief.lineMessage), /M5\.2/);
    assert.match(String(brief.lineMessage), /WTI 78\.12/);
    assert.match(String(brief.lineMessage), /EURTHB/);
    assert.match(String(brief.lineMessage), /Thailand and Cambodia hold border talks/);
    assert.match(String(brief.lineMessage), /ต้องยืนยันจากช่องทางทางการ/);
    assert.doesNotMatch(String(brief.lineMessage), /ยังไม่พบรายงานปะทะ/);
    assert.ok((brief.generatedFrom as string[]).includes('topman-core:earthquakes'));
    assert.ok((brief.generatedFrom as string[]).includes('topman-core:commodities'));
    assert.ok((brief.sources as string[]).includes('USGS'));
    assert.ok((brief.sources as string[]).includes('Yahoo Finance'));
  });

  it('keeps only ASEAN+security GDELT titles, drops haze, and dedups topic copies', () => {
    const summary = summarizeTopmanCoreForBrief({
      gdeltIntel: {
        topics: [
          {
            id: 'intelligence',
            articles: [
              { title: 'Malaysian PM says ASEAN haze mechanism in need of review', url: 'https://example.test/haze' },
              { title: 'Thailand and Cambodia hold border talks', url: 'https://example.test/border' },
            ],
          },
          {
            id: 'military',
            articles: [
              { title: 'Thailand and Cambodia hold border talks', url: 'https://example.test/border' },
            ],
          },
        ],
      },
    });
    assert.match(summary.security, /Thailand and Cambodia hold border talks/);
    assert.doesNotMatch(summary.security, /haze/);
    assert.equal(summary.security.match(/Thailand and Cambodia hold border talks/g)?.length, 1);
  });

  it('attributes Yahoo Finance when gold is the only commodity used', () => {
    const summary = summarizeTopmanCoreForBrief({
      commodityQuotes: {
        quotes: [{ display: 'GOLD', name: 'Gold', price: 2480.5, change: 0.35 }],
      },
    });
    assert.match(summary.markets, /ทองคำ 2480\.50/);
    assert.ok(summary.sources.includes('Yahoo Finance'));
    assert.ok(summary.used.includes('commodities'));
    assert.equal(summary.energy, '');
  });

  it('labels US-only NWS weather as foreign when no ASEAN disaster signal exists', () => {
    const summary = summarizeTopmanCoreForBrief({
      weatherAlerts: {
        alerts: [
          { headline: 'Heat Advisory for Arizona', event: 'Heat Advisory', areaDesc: 'Arizona' },
        ],
      },
    });
    assert.match(summary.disaster, /ต่างประเทศ/);
    assert.match(summary.disaster, /ยังไม่ใช่ประกาศ ปภ/);
    assert.equal(summary.security, '');
  });

  it('keeps empty-core drafts honest instead of inventing Thai retail or SET numbers', () => {
    const brief = buildTopmanDailyBrief({
      nowMs: Date.parse('2026-09-01T00:30:00.000Z'),
      insights: { topStories: [] },
      core: {},
    });
    assert.match(String(brief.lineMessage), /ยังไม่มีประเด็นความมั่นคงที่ระบุชัด/);
    assert.match(String(brief.lineMessage), /ยังไม่พบประเด็นภัยพิบัติ/);
    assert.match(String(brief.lineMessage), /ยังไม่พบประเด็นพลังงาน/);
    assert.doesNotMatch(String(brief.lineMessage), /SET/);
    assert.deepEqual(brief.generatedFrom, []);
  });

  it('supports patch → approve → sent workflow', () => {
    let brief = buildTopmanDailyBrief({
      nowMs: Date.parse('2026-08-04T00:30:00.000Z'),
      insights: { topStories: [] },
    });
    brief = patchTopmanDailyBrief(brief, {
      lineMessage: 'เรียน ผบ.ตร. / นายกรัฐมนตรี\nสรุปทดสอบ',
      nowMs: Date.parse('2026-08-04T00:40:00.000Z'),
    });
    assert.match(String(brief.lineMessage), /สรุปทดสอบ/);
    brief = approveTopmanDailyBrief(brief, Date.parse('2026-08-04T00:45:00.000Z'));
    assert.equal(brief.status, 'approved');
    brief = markTopmanDailyBriefSent(brief, Date.parse('2026-08-04T00:50:00.000Z'));
    assert.equal(brief.status, 'sent');
    assert.ok(brief.sentAt);
  });
});
