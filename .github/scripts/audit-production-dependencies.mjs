#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEVERITY_RANK = new Map([
  ['info', 0],
  ['low', 1],
  ['moderate', 2],
  ['high', 3],
  ['critical', 4],
]);

export const BASELINE_ADVISORIES_BY_LOCKFILE = {
  'package-lock.json': [
    // No patched image-size release exists yet. The lock-shape regression test
    // limits these exceptions to browser-inaccessible Metro/texture tooling.
    'GHSA-5p2g-fcmc-qvqq',
    'GHSA-w3rx-r6r6-pgpr',
  ],
  'consumer-prices-core/package-lock.json': [],
  'blog-site/package-lock.json': [],
  // Same no-fix Metro-only path as the root lockfile, guarded below by tests.
  'pro-test/package-lock.json': ['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr'],
  'scripts/package-lock.json': [],
  'docker/runtime-package-lock.json': [],
};

// Time-boxed acceptances. Kept separate from BASELINE_ADVISORIES_BY_LOCKFILE
// so dependency-bump PRs can edit that object without conflicting here.
//
// pro-test is deployed: pro-test/vite.config.ts writes the committed
// public/pro/ bundle, and Vercel serves that directory verbatim (/pro, and
// the upstream apex rewrite to /pro/welcome.html). The root build does not
// rebuild it. GHSA-vfj7-8cjw-p6xm (braces) is reached only via Metro build
// tooling pulled by Clerk 5 in pro-test — @clerk/clerk-js →
// @solana/wallet-adapter-react → @solana-mobile/wallet-adapter-mobile's
// react-native peer → @react-native/community-cli-plugin → metro →
// metro-file-map → micromatch → braces — not by the browser runtime.
// Expires 2026-11-10 (UTC date, inclusive). Tracked follow-up: migrate
// pro-test to Clerk 6. A still-present advisory fails the audit after that
// date so the migration gets revisited.
export const EXPIRING_ADVISORIES_BY_LOCKFILE = {
  'pro-test/package-lock.json': [
    {
      id: 'GHSA-vfj7-8cjw-p6xm',
      expires: '2026-11-10',
      reason:
        'braces is reached only via Metro build tooling pulled by Clerk 5 in pro-test, not browser runtime. The built site is deployed from public/pro/. Expires 2026-11-10. Tracked follow-up: migrate pro-test to Clerk 6.',
    },
  ],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function utcDateStamp(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid now value for advisory expiry check');
  }
  return date.toISOString().slice(0, 10);
}

export function isExpiringAdvisoryActive(entry, now = new Date()) {
  const expires = entry?.expires ?? '';
  if (!ISO_DATE.test(expires)) return false;
  const parsed = new Date(`${expires}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== expires) return false;
  return utcDateStamp(now) <= expires;
}

export function expiringAdvisoryEntries(lockfile) {
  return EXPIRING_ADVISORIES_BY_LOCKFILE[lockfile] ?? [];
}

function severityRank(severity) {
  return SEVERITY_RANK.get(String(severity ?? '').toLowerCase()) ?? -1;
}

function advisoryId(advisory) {
  const urlId = String(advisory.url ?? '').match(/GHSA-[a-z0-9-]+/i)?.[0];
  if (urlId) return urlId;
  if (advisory.source) return String(advisory.source);
  return `${advisory.name ?? 'unknown'}:${advisory.title ?? 'untitled'}`;
}

export function collectAuditFindings(report, auditLevel = 'high') {
  const findings = new Map();

  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (!via || typeof via !== 'object') continue;

      const severity = via.severity ?? vulnerability.severity;
      if (severityRank(severity) < severityRank(auditLevel)) continue;

      const id = advisoryId(via);
      const name = via.name ?? vulnerability.name ?? 'unknown';
      const key = `${id}:${name}`;
      findings.set(key, {
        id,
        name,
        severity,
        title: via.title ?? 'Untitled advisory',
        url: via.url ?? '',
      });
    }
  }

  return [...findings.values()].sort((a, b) => `${a.id}:${a.name}`.localeCompare(`${b.id}:${b.name}`));
}

export function collectUnbaselinedFindings(report, lockfile, auditLevel = 'high', now = new Date()) {
  const accepted = new Set(BASELINE_ADVISORIES_BY_LOCKFILE[lockfile] ?? []);
  for (const entry of expiringAdvisoryEntries(lockfile)) {
    if (isExpiringAdvisoryActive(entry, now)) accepted.add(entry.id);
  }
  return collectAuditFindings(report, auditLevel).filter((finding) => !accepted.has(finding.id));
}

export function collectAdvisoryIds(report) {
  const ids = new Set();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (!via || typeof via !== 'object') continue;
      ids.add(advisoryId(via));
    }
  }
  return ids;
}

export function collectStaleBaselineEntries(report, lockfile) {
  const present = collectAdvisoryIds(report);
  return (BASELINE_ADVISORIES_BY_LOCKFILE[lockfile] ?? []).filter((id) => !present.has(id));
}

export function collectStaleExpiringEntries(report, lockfile) {
  const present = collectAdvisoryIds(report);
  const stale = [];
  for (const entry of expiringAdvisoryEntries(lockfile)) {
    if (!entry?.id || present.has(entry.id) || stale.includes(entry.id)) continue;
    stale.push(entry.id);
  }
  return stale;
}

export function collectExpiredAdvisoryHits(report, lockfile, auditLevel = 'high', now = new Date()) {
  const expired = new Set(
    expiringAdvisoryEntries(lockfile)
      .filter((entry) => entry?.id && !isExpiringAdvisoryActive(entry, now))
      .map((entry) => entry.id),
  );
  return collectAuditFindings(report, auditLevel).filter((finding) => expired.has(finding.id));
}

export function formatExpiredAdvisoryError(finding, entry, lockfile) {
  const when = entry?.expires ?? 'unknown';
  const why = entry?.reason ? ` ${entry.reason}` : '';
  return `::error title=Expired advisory acceptance::${finding.id} acceptance for ${lockfile} expired on ${when}. Revisit the tracked follow-up: migrate pro-test to Clerk 6.${why}`;
}

function parseArgs(argv) {
  const args = {
    auditLevel: 'high',
    workspace: '.',
    packageJson: '',
    lockfile: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--audit-level') args.auditLevel = argv[++i] ?? args.auditLevel;
    else if (arg === '--workspace') args.workspace = argv[++i] ?? args.workspace;
    else if (arg === '--package-json') args.packageJson = argv[++i] ?? args.packageJson;
    else if (arg === '--lockfile') args.lockfile = argv[++i] ?? args.lockfile;
  }

  if (!args.lockfile) {
    throw new Error(
      'Usage: audit-production-dependencies.mjs --workspace <path> [--package-json <package.json>] --lockfile <package-lock.json>',
    );
  }
  args.packageJson ||= `${args.workspace.replace(/\/$/, '')}/package.json`;

  return args;
}

function resolveAuditWorkspace({ workspace, packageJson, lockfile }) {
  const workspacePackageJson = resolve(workspace, 'package.json');
  const workspaceLockfile = resolve(workspace, 'package-lock.json');

  if (packageJson === workspacePackageJson && lockfile === workspaceLockfile) {
    return {
      cwd: workspace,
      cleanup: () => {},
    };
  }

  const auditDir = mkdtempSync(join(tmpdir(), 'worldmonitor-security-audit-'));
  copyFileSync(packageJson, join(auditDir, 'package.json'));
  copyFileSync(lockfile, join(auditDir, 'package-lock.json'));

  return {
    cwd: auditDir,
    cleanup: () => rmSync(auditDir, { recursive: true, force: true }),
  };
}

function readAuditReport({ workspace, packageJson, lockfile }) {
  const auditWorkspace = resolveAuditWorkspace({ workspace, packageJson, lockfile });
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: auditWorkspace.cwd,
    encoding: 'utf8',
  });

  try {
    const json = result.stdout.trim();

    if (!json) {
      process.stderr.write(result.stderr);
      throw new Error(`npm audit did not return JSON for ${workspace}`);
    }

    let report;
    try {
      report = JSON.parse(json);
    } catch (error) {
      process.stderr.write(result.stderr);
      throw new Error(`Could not parse npm audit JSON for ${workspace}: ${error.message}`);
    }

    if (report.error) {
      throw new Error(report.error.summary ?? report.error.detail ?? `npm audit failed for ${workspace}`);
    }

    return report;
  } finally {
    auditWorkspace.cleanup();
  }
}

function printFinding(prefix, finding) {
  const suffix = finding.url ? ` (${finding.url})` : '';
  console.log(`${prefix} ${finding.severity} ${finding.id} ${finding.name}: ${finding.title}${suffix}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const workspace = resolve(process.cwd(), args.workspace);
  const packageJson = resolve(process.cwd(), args.packageJson);
  const lockfile = resolve(process.cwd(), args.lockfile);
  const report = readAuditReport({ workspace, packageJson, lockfile });
  const allFindings = collectAuditFindings(report, args.auditLevel);
  const unbaselined = collectUnbaselinedFindings(report, args.lockfile, args.auditLevel, now);
  const unbaselinedKeys = new Set(unbaselined.map((finding) => `${finding.id}:${finding.name}`));
  const activeExpiringIds = new Set(
    expiringAdvisoryEntries(args.lockfile)
      .filter((entry) => isExpiringAdvisoryActive(entry, now))
      .map((entry) => entry.id),
  );
  const baselineIds = new Set(BASELINE_ADVISORIES_BY_LOCKFILE[args.lockfile] ?? []);

  for (const finding of allFindings.filter((item) => !unbaselinedKeys.has(`${item.id}:${item.name}`))) {
    if (activeExpiringIds.has(finding.id) && !baselineIds.has(finding.id)) {
      printFinding('::warning title=Time-boxed production advisory::', finding);
    } else {
      printFinding('::warning title=Baselined production advisory::', finding);
    }
  }

  for (const staleId of collectStaleBaselineEntries(report, args.lockfile)) {
    console.log(
      `::warning title=Stale baseline entry::${staleId} is baselined for ${args.lockfile} but matched no current advisory; remove it from BASELINE_ADVISORIES_BY_LOCKFILE.`,
    );
  }

  for (const staleId of collectStaleExpiringEntries(report, args.lockfile)) {
    console.log(
      `::warning title=Stale expiring advisory::${staleId} is time-boxed for ${args.lockfile} but matched no current advisory; remove it from EXPIRING_ADVISORIES_BY_LOCKFILE.`,
    );
  }

  const expiredHits = collectExpiredAdvisoryHits(report, args.lockfile, args.auditLevel, now);
  for (const finding of expiredHits) {
    const entry = expiringAdvisoryEntries(args.lockfile).find((item) => item.id === finding.id);
    console.error(formatExpiredAdvisoryError(finding, entry, args.lockfile));
  }

  if (unbaselined.length > 0) {
    console.error(`Found ${unbaselined.length} unbaselined ${args.auditLevel}+ production advisories in ${args.lockfile}:`);
    for (const finding of unbaselined) {
      printFinding('::error title=Unbaselined production advisory::', finding);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Production audit OK for ${args.lockfile}: ${allFindings.length} ${args.auditLevel}+ advisories are baselined or absent.`);
}

export function isInvokedAsScript(entryPath, moduleUrl) {
  if (!entryPath) return false;
  try {
    // Resolve symlinks on both sides: Node sets import.meta.url to the realpath, but
    // process.argv[1] keeps the symlinked path (e.g. macOS /tmp -> /private/tmp), so a
    // raw href comparison silently no-ops — the dangerous fail-open for a security gate.
    const entry = pathToFileURL(realpathSync(entryPath)).href;
    const self = pathToFileURL(realpathSync(fileURLToPath(moduleUrl))).href;
    return entry === self;
  } catch {
    return moduleUrl === pathToFileURL(entryPath).href;
  }
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
