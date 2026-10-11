import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BASELINE_ADVISORIES_BY_LOCKFILE,
  collectExpiredAdvisoryHits,
  collectStaleExpiringEntries,
  collectUnbaselinedFindings,
  EXPIRING_ADVISORIES_BY_LOCKFILE,
  formatExpiredAdvisoryError,
  isExpiringAdvisoryActive,
} from '../.github/scripts/audit-production-dependencies.mjs';

const BRACES = 'GHSA-vfj7-8cjw-p6xm';
const LOCKFILE = 'pro-test/package-lock.json';
const LAST_ACCEPTED_DAY = new Date('2026-11-10T23:59:59.999Z');
const FIRST_EXPIRED_DAY = new Date('2026-11-11T00:00:00.000Z');

function bracesReport() {
  return {
    vulnerabilities: {
      braces: {
        name: 'braces',
        severity: 'high',
        via: [
          {
            name: 'braces',
            severity: 'high',
            title: 'Uncontrolled resource consumption in braces',
            url: `https://github.com/advisories/${BRACES}`,
          },
        ],
      },
    },
  };
}

describe('expiring production advisories', () => {
  it('keeps the braces acceptance out of the permanent baseline', () => {
    const [entry] = EXPIRING_ADVISORIES_BY_LOCKFILE[LOCKFILE];
    assert.equal(entry.id, BRACES);
    assert.equal(entry.expires, '2026-11-10');
    assert.match(entry.reason, /Metro build tooling/);
    assert.match(entry.reason, /Clerk 5/);
    assert.match(entry.reason, /not browser runtime/);
    assert.match(entry.reason, /Clerk 6/);
    assert.equal(BASELINE_ADVISORIES_BY_LOCKFILE[LOCKFILE].includes(BRACES), false);
    assert.equal(isExpiringAdvisoryActive(entry, LAST_ACCEPTED_DAY), true);
    assert.equal(isExpiringAdvisoryActive(entry, FIRST_EXPIRED_DAY), false);
  });

  it('accepts the advisory before expiry', () => {
    assert.deepEqual(
      collectUnbaselinedFindings(bracesReport(), LOCKFILE, 'high', LAST_ACCEPTED_DAY),
      [],
    );
    assert.deepEqual(
      collectExpiredAdvisoryHits(bracesReport(), LOCKFILE, 'high', LAST_ACCEPTED_DAY),
      [],
    );
    assert.deepEqual(collectStaleExpiringEntries(bracesReport(), LOCKFILE), []);
  });

  it('fails loudly after expiry while the advisory is still present', () => {
    const findings = collectUnbaselinedFindings(bracesReport(), LOCKFILE, 'high', FIRST_EXPIRED_DAY);
    assert.deepEqual(findings.map((finding) => finding.id), [BRACES]);

    const expired = collectExpiredAdvisoryHits(bracesReport(), LOCKFILE, 'high', FIRST_EXPIRED_DAY);
    assert.equal(expired.length, 1);
    const entry = EXPIRING_ADVISORIES_BY_LOCKFILE[LOCKFILE][0];
    const message = formatExpiredAdvisoryError(expired[0], entry, LOCKFILE);
    assert.match(message, /::error title=Expired advisory acceptance::/);
    assert.match(message, new RegExp(BRACES));
    assert.match(message, /expired on 2026-11-10/);
    assert.match(message, /migrate pro-test to Clerk 6/);
  });

  it('reports a time-boxed entry as stale once the advisory disappears', () => {
    const gone = { vulnerabilities: {} };
    assert.deepEqual(collectStaleExpiringEntries(gone, LOCKFILE), [BRACES]);
    assert.deepEqual(collectUnbaselinedFindings(gone, LOCKFILE, 'high', LAST_ACCEPTED_DAY), []);
    assert.deepEqual(collectUnbaselinedFindings(gone, LOCKFILE, 'high', FIRST_EXPIRED_DAY), []);
    assert.deepEqual(collectExpiredAdvisoryHits(gone, LOCKFILE, 'high', FIRST_EXPIRED_DAY), []);
    assert.deepEqual(collectStaleExpiringEntries(gone, 'package-lock.json'), []);
  });
});
