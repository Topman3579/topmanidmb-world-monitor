import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  approveTopmanDailyBrief,
  bangkokDateKey,
  buildTopmanDailyBrief,
  formatThaiOfficialDate,
  formatThaiShortDate,
  isTopmanDailyBrief,
  isTopmanDailyBriefApprovable,
  markTopmanDailyBriefSent,
  MAX_LINE_MESSAGE_CHARS,
  patchTopmanDailyBrief,
} from '../shared/topman-daily-brief.js';

describe('TOPMAN daily executive brief', () => {
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

  it('blocks placeholder-only briefs from approval eligibility', () => {
    const placeholder = buildTopmanDailyBrief({
      nowMs: Date.parse('2026-08-04T00:30:00.000Z'),
      insights: { topStories: [] },
    });
    const backed = buildTopmanDailyBrief({
      nowMs: Date.parse('2026-08-04T00:30:00.000Z'),
      insights: {
        worldBrief: 'Verified market overview',
        topStories: [{
          primaryTitle: 'SET closes higher on foreign inflows',
          primarySource: 'SET',
          category: 'markets',
        }],
      },
    });

    assert.equal(isTopmanDailyBriefApprovable(placeholder), false);
    assert.equal(isTopmanDailyBriefApprovable(backed), true);
  });

  it('returns approved or sent briefs to draft when their content changes', () => {
    const base = buildTopmanDailyBrief({
      nowMs: Date.parse('2026-08-04T00:30:00.000Z'),
      insights: {
        worldBrief: 'Verified market overview',
        topStories: [{ primaryTitle: 'Market update', primarySource: 'SET', category: 'markets' }],
      },
    });
    const approved = approveTopmanDailyBrief(base);
    const unchanged = patchTopmanDailyBrief(approved, { lineMessage: approved.lineMessage as string });
    const edited = patchTopmanDailyBrief(approved, { lineMessage: 'ข้อความใหม่ที่ยังไม่อนุมัติ' });
    const sent = markTopmanDailyBriefSent(approved);
    const editedSent = patchTopmanDailyBrief(sent, { memoMarkdown: 'ร่างใหม่' });

    assert.equal(unchanged.status, 'approved');
    assert.equal(edited.status, 'draft');
    assert.equal(edited.approvedAt, null);
    assert.equal(editedSent.status, 'draft');
    assert.equal(editedSent.sentAt, null);
  });
});
