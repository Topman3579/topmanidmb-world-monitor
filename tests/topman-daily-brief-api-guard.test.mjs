import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('../api/topman-daily-brief.ts', import.meta.url), 'utf8');

describe('TOPMAN daily brief API release guards', () => {
  it('separates the reviewer credential from the cron credential', () => {
    const adminBody = source.match(/function adminSecret\(\)[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(adminBody, /TOPMAN_BRIEF_ADMIN_SECRET/);
    assert.doesNotMatch(adminBody, /CRON_SECRET/);
  });

  it('pins every write to the validated target date', () => {
    assert.match(source, /brief = \{ \.\.\.brief, dateKey: targetDate \};/);
  });

  it('claims an approved revision before LINE delivery and fails closed', () => {
    const sendStart = source.indexOf("if (action === 'send')");
    const sendSource = source.slice(sendStart);
    const claim = sendSource.indexOf('await claimBriefSend(brief)');
    const push = sendSource.indexOf('await pushLineTextMessage');
    assert.ok(claim >= 0 && push > claim, 'atomic send claim must precede provider delivery');
    assert.match(sendSource, /SEND_GUARD_UNAVAILABLE/);
    assert.match(sendSource, /SEND_IN_PROGRESS/);
    assert.match(sendSource, /STATE_SAVE_FAILED/);
    assert.match(sendSource, /if \(!storedBrief\)/);
    assert.doesNotMatch(sendSource.slice(0, push), /patchTopmanDailyBrief/);
  });

  it('never advertises the cron credential as a reviewer credential', () => {
    const postStart = source.indexOf("if (request.method !== 'POST')");
    const postSource = source.slice(postStart);
    assert.doesNotMatch(postSource, /TOPMAN_BRIEF_ADMIN_SECRET หรือ CRON_SECRET/);
  });
});
