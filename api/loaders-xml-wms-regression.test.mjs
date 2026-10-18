import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The unused deck.gl umbrella previously pulled XML/WMS loaders into this app.
// Keep them absent instead of reinstalling vulnerable, unused parsing surfaces
// merely to exercise the old upstream compatibility tests.
test('unused XML/WMS loader surfaces stay outside the installed dependency graph', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const packages = Object.keys(lock.packages);
  for (const name of ['deck.gl', '@deck.gl/mapbox', '@loaders.gl/xml', '@loaders.gl/wms']) {
    assert.equal(packages.some((path) => path.endsWith(`node_modules/${name}`)), false,
      `Unexpected unused dependency: ${name}; review the import and security exposure before restoring it`);
  }
  for (const name of ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/maplibre']) {
    assert.ok(lock.packages[`node_modules/${name}`], `Required rendering dependency missing: ${name}`);
  }
});
