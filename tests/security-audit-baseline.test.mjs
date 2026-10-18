import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  BASELINE_ADVISORIES_BY_LOCKFILE,
  collectAuditFindings,
  collectStaleBaselineEntries,
  collectUnbaselinedFindings,
  isInvokedAsScript,
} from '../.github/scripts/audit-production-dependencies.mjs';

function auditReportWith(via) {
  return {
    vulnerabilities: {
      [via.name]: {
        name: via.name,
        severity: via.severity,
        via: [via],
      },
    },
  };
}

function readRepoJson(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

function lockedVersions(lockfile, dependencyName) {
  return Object.entries(lockfile.packages ?? {})
    .filter(([path]) => path.endsWith(`/node_modules/${dependencyName}`) || path === `node_modules/${dependencyName}`)
    .map(([, pkg]) => pkg.version)
    .sort();
}

describe('security audit baseline', () => {
  it('does not exempt formerly baselined pro-test advisories', () => {
    const report = auditReportWith({
      name: 'shell-quote',
      severity: 'high',
      title: 'shell-quote DoS',
      url: 'https://github.com/advisories/GHSA-395f-4hp3-45gv',
    });

    assert.equal(collectUnbaselinedFindings(report, 'pro-test/package-lock.json').length, 1);
    assert.equal(
      BASELINE_ADVISORIES_BY_LOCKFILE['pro-test/package-lock.json'].includes('GHSA-395f-4hp3-45gv'),
      false,
    );
  });

  it('ignores moderate production advisories for the high-severity PR gate', () => {
    const report = auditReportWith({
      name: 'uuid',
      severity: 'moderate',
      title: 'moderate advisory',
      url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq',
    });

    assert.deepEqual(collectAuditFindings(report), []);
  });

  it('fails a new unbaselined high advisory', () => {
    const report = auditReportWith({
      name: 'new-package',
      severity: 'high',
      title: 'new advisory',
      url: 'https://github.com/advisories/GHSA-1111-2222-3333',
    });

    assert.deepEqual(collectUnbaselinedFindings(report, 'package-lock.json'), [
      {
        id: 'GHSA-1111-2222-3333',
        name: 'new-package',
        severity: 'high',
        title: 'new advisory',
        url: 'https://github.com/advisories/GHSA-1111-2222-3333',
      },
    ]);
  });

  it('tracks a baseline entry for each audited lockfile', () => {
    assert.deepEqual(Object.keys(BASELINE_ADVISORIES_BY_LOCKFILE).sort(), [
      'blog-site/package-lock.json',
      'consumer-prices-core/package-lock.json',
      'docker/runtime-package-lock.json',
      'package-lock.json',
      'pro-test/package-lock.json',
      'scripts/package-lock.json',
    ]);
  });

  it('keeps consumer-prices-core on the Fastify v5 audit fix', () => {
    const packageJson = readRepoJson('consumer-prices-core/package.json');
    const lockfile = readRepoJson('consumer-prices-core/package-lock.json');

    assert.match(packageJson.dependencies.fastify, /^\^5\./);
    assert.match(packageJson.dependencies['@fastify/cors'], /^\^11\./);
    assert.match(packageJson.dependencies['js-yaml'], /^\^4\.(?:[2-9]|\d{2,})\./);
    assert.match(lockfile.packages['node_modules/fastify']?.version, /^5\./);
    assert.match(lockfile.packages['node_modules/@fastify/cors']?.version, /^11\./);
    assert.match(lockfile.packages['node_modules/js-yaml']?.version, /^4\.(?:[2-9]|\d{2,})\./);
    assert.deepEqual(BASELINE_ADVISORIES_BY_LOCKFILE['consumer-prices-core/package-lock.json'], []);
  });

  it('keeps the root esbuild audit fix scoped away from Vite build tooling', () => {
    const packageJson = readRepoJson('package.json');
    const lockfile = readRepoJson('package-lock.json');
    const rootEsbuild = lockfile.packages['node_modules/esbuild'];
    const vite = lockfile.packages['node_modules/vite'];
    const viteEsbuild = lockfile.packages['node_modules/vite/node_modules/esbuild'];

    assert.equal(packageJson.overrides?.esbuild, undefined);
    assert.equal(packageJson.overrides?.convex?.esbuild, '0.28.1');
    assert.equal(rootEsbuild?.version, '0.28.1');
    assert.equal(vite?.dependencies?.esbuild, '^0.25.0');
    assert.ok(viteEsbuild, 'Vite must keep its own esbuild when root uses the audit-patched version');
    assert.match(viteEsbuild.version, /^0\.25\./);
    assert.notEqual(viteEsbuild.version, rootEsbuild.version);
  });

  it('does not retain the patched shell-quote baseline', () => {
    const advisory = 'GHSA-395f-4hp3-45gv';
    assert.equal(BASELINE_ADVISORIES_BY_LOCKFILE['pro-test/package-lock.json'].includes(advisory), false);
    assert.equal(BASELINE_ADVISORIES_BY_LOCKFILE['package-lock.json'].includes(advisory), false);
  });

  it('reports a no-fix baseline entry as stale as soon as its advisory disappears', () => {
    const lockfile = 'pro-test/package-lock.json';
    const advisories = BASELINE_ADVISORIES_BY_LOCKFILE[lockfile];
    const reportWith = (ids) => ({
      vulnerabilities: {
        'image-size': {
          name: 'image-size',
          severity: 'high',
          via: ids.map((id) => ({
            name: 'image-size',
            severity: 'high',
            title: 'image-size denial of service',
            url: `https://github.com/advisories/${id}`,
          })),
        },
      },
    });

    assert.deepEqual(collectStaleBaselineEntries(reportWith(advisories), lockfile), []);
    assert.deepEqual(
      collectStaleBaselineEntries(reportWith(advisories.slice(0, 1)), lockfile),
      advisories.slice(1),
    );
  });

  it('removes the root mobile/Metro production path without exempting advisories', () => {
    const rootPackage = readRepoJson('package.json');
    const rootLock = readRepoJson('package-lock.json');

    assert.deepEqual(BASELINE_ADVISORIES_BY_LOCKFILE['package-lock.json'], []);
    // Vite reads the manifest version for the CDN SDK URL, so a range can
    // silently load an older runtime than the installed SDK/types.
    const clerkVersion = rootPackage.dependencies['@clerk/clerk-js'];
    assert.match(clerkVersion, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(lockedVersions(rootLock, '@clerk/clerk-js'), [clerkVersion]);
    assert.equal(rootPackage.overrides?.['react-native'], undefined);
    for (const name of ['@solana/wallet-adapter-react', 'react-native', 'metro', 'image-size']) {
      assert.deepEqual(lockedVersions(rootLock, name), [], `${name} must not return through Clerk`);
    }
    // Build/test tooling can still require braces, but no production edge may
    // reintroduce its unpatched advisory into the root dependency graph.
    for (const [path, pkg] of Object.entries(rootLock.packages)) {
      if (path === 'node_modules/braces' || path.endsWith('/node_modules/braces')) {
        assert.equal(pkg.dev, true, `${path} must remain development-only`);
      }
    }
  });

  it('keeps the react-native/Metro peer path out of pro-test without exemptions', () => {
    const proPackage = readRepoJson('pro-test/package.json');
    const proLock = readRepoJson('pro-test/package-lock.json');
    const proNpmrc = readFileSync(new URL('../pro-test/.npmrc', import.meta.url), 'utf8');

    assert.deepEqual(BASELINE_ADVISORIES_BY_LOCKFILE['pro-test/package-lock.json'], []);
    assert.match(proNpmrc, /^legacy-peer-deps=true$/m);
    assert.equal(proPackage.dependencies?.['image-size'], undefined);
    for (const name of ['react-native', 'metro', 'image-size', 'braces', 'micromatch']) {
      assert.deepEqual(lockedVersions(proLock, name), [], `${name} must not return to pro-test through Clerk`);
    }
  });

  it('treats a symlinked entry path as direct invocation (no silent fail-open)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-guard-'));
    try {
      const real = join(dir, 'audit.mjs');
      writeFileSync(real, '// stub\n');
      const link = join(dir, 'audit-link.mjs');
      symlinkSync(real, link);
      const moduleUrl = pathToFileURL(real).href;

      // Invoked through the symlink, the guard still fires (the bug being fixed).
      assert.equal(isInvokedAsScript(link, moduleUrl), true);
      assert.equal(isInvokedAsScript(real, moduleUrl), true);
      // A different file must not be mistaken for the module entry.
      assert.equal(isInvokedAsScript(join(dir, 'other.mjs'), moduleUrl), false);
      assert.equal(isInvokedAsScript(undefined, moduleUrl), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
