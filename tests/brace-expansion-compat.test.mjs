import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { BASELINE_ADVISORIES_BY_LOCKFILE } from '../.github/scripts/audit-production-dependencies.mjs';

const require = createRequire(import.meta.url);
const scriptsRequire = createRequire(new URL('../scripts/package.json', import.meta.url));

function loadDependencyFrom(packageName, dependencyName, baseRequire = require) {
  const packageRequire = createRequire(baseRequire.resolve(`${packageName}/package.json`));
  return {
    module: packageRequire(dependencyName),
    version: packageRequire(`${dependencyName}/package.json`).version,
    require: packageRequire,
  };
}

function assertBracePatterns(minimatch) {
  assert.equal(minimatch('src.js', '{src,test}.js'), true);
  assert.equal(minimatch('test.js', '{src,test}.js'), true);
  assert.equal(minimatch('other.js', '{src,test}.js'), false);
  assert.equal(minimatch('file3.txt', 'file{1..3}.txt'), true);
  assert.equal(minimatch('file4.txt', 'file{1..3}.txt'), false);
}

describe('brace-expansion compatibility', () => {
  it('executes brace patterns through minimatch 3', () => {
    const minimatch = require('minimatch');
    const version = require('minimatch/package.json').version;

    assert.match(version, /^3\./);
    assertBracePatterns(minimatch);
  });

  it('executes brace patterns through minimatch 5', () => {
    const minimatch = loadDependencyFrom('readdir-glob', 'minimatch');

    assert.match(minimatch.version, /^5\./);
    assertBracePatterns(minimatch.module);
  });
});

describe('scripts workspace brace-expansion compatibility', () => {
  it('executes brace patterns through minimatch 3', () => {
    const minimatch = scriptsRequire('minimatch');
    const version = scriptsRequire('minimatch/package.json').version;

    assert.match(version, /^3\./);
    assertBracePatterns(minimatch);
  });

  it('executes brace patterns through minimatch 5', () => {
    const minimatch = loadDependencyFrom('readdir-glob', 'minimatch', scriptsRequire);

    assert.match(minimatch.version, /^5\./);
    assertBracePatterns(minimatch.module);
  });

  it('keeps the official maintenance backports and enforces their expansion-length cap', () => {
    const minimatch3Require = createRequire(scriptsRequire.resolve('minimatch/package.json'));
    const minimatch5 = loadDependencyFrom('readdir-glob', 'minimatch', scriptsRequire);
    const braceV1 = {
      module: minimatch3Require('brace-expansion'),
      version: minimatch3Require('brace-expansion/package.json').version,
    };
    const braceV2 = {
      module: minimatch5.require('brace-expansion'),
      version: minimatch5.require('brace-expansion/package.json').version,
    };

    assert.equal(braceV1.version, '1.1.17');
    assert.equal(braceV2.version, '2.1.3');
    assert.deepEqual(
      BASELINE_ADVISORIES_BY_LOCKFILE['scripts/package-lock.json'],
      ['GHSA-mh99-v99m-4gvg'],
    );

    for (const brace of [braceV1.module, braceV2.module]) {
      const expanded = brace('{a,b}'.repeat(10), { maxLength: 100 });
      const totalLength = expanded.reduce((total, item) => total + item.length, 0);
      assert.ok(totalLength <= 100, `expansion length cap exceeded: ${totalLength}`);
    }
  });
});
