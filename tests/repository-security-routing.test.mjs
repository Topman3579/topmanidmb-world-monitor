import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const readRepoFile = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

describe('repository security ownership routes', () => {
  it('assigns protected API-contract files to the fork owner', () => {
    const codeowners = readRepoFile('.github/CODEOWNERS');

    assert.match(codeowners, /^\/api\/api-route-exceptions\.json @Topman3579$/m);
    assert.match(codeowners, /^\/scripts\/enforce-sebuf-api-contract\.mjs @Topman3579$/m);
    assert.doesNotMatch(codeowners, /@SebastienMelki/);
  });

  it('routes vulnerability reports to this fork without publishing contact details', () => {
    const securityPolicy = readRepoFile('SECURITY.md');

    assert.match(
      securityPolicy,
      /https:\/\/github\.com\/Topman3579\/topmanidmb-world-monitor\/security\/advisories\/new/,
    );
    assert.match(securityPolicy, /\[@Topman3579\]\(https:\/\/github\.com\/Topman3579\)/);
    assert.doesNotMatch(securityPolicy, /github\.com\/koala73(?:\/worldmonitor)?/);
    assert.doesNotMatch(securityPolicy, /mailto:|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });
});
