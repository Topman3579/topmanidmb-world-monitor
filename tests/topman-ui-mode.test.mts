import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeTopmanUiMode,
  readTopmanUiModeFromUrl,
  resolveTopmanUiMode,
  urlImpliesAdvancedDashboard,
  writeTopmanUiModeToUrl,
} from '../src/services/topman-ui-mode.ts';

describe('topman-ui-mode', () => {
  it('normalizes only simple/advanced', () => {
    assert.equal(normalizeTopmanUiMode('simple'), 'simple');
    assert.equal(normalizeTopmanUiMode('ADVANCED'), 'advanced');
    assert.equal(normalizeTopmanUiMode('expert'), null);
    assert.equal(normalizeTopmanUiMode(''), null);
  });

  it('reads mode from URL', () => {
    assert.equal(readTopmanUiModeFromUrl('?mode=simple'), 'simple');
    assert.equal(readTopmanUiModeFromUrl('?mode=advanced&view=asia'), 'advanced');
    assert.equal(readTopmanUiModeFromUrl('?view=asia'), null);
  });

  it('detects deep-link advanced intent without inventing mode', () => {
    assert.equal(urlImpliesAdvancedDashboard('?country=TH'), true);
    assert.equal(urlImpliesAdvancedDashboard('?chokepoint=strait_of_malacca'), true);
    // Layer strings alone must not force advanced — Simple Mode writes them too.
    assert.equal(urlImpliesAdvancedDashboard('?layers=conflicts'), false);
    assert.equal(urlImpliesAdvancedDashboard('?mode=simple&country=TH'), false);
    assert.equal(urlImpliesAdvancedDashboard(''), false);
  });

  it('defaults new users to simple and honors storage / URL / deep links', () => {
    assert.equal(resolveTopmanUiMode({ search: '', stored: null }), 'simple');
    assert.equal(resolveTopmanUiMode({ search: '', stored: 'advanced' }), 'advanced');
    assert.equal(resolveTopmanUiMode({ search: '?mode=simple', stored: 'advanced' }), 'simple');
    // Stored preference wins over deep-link implication so map URL rewrite cannot thrash mode.
    assert.equal(resolveTopmanUiMode({ search: '?country=UA', stored: 'simple' }), 'simple');
    assert.equal(resolveTopmanUiMode({ search: '?country=UA', stored: null }), 'advanced');
  });

  it('writes mode into URL search params', () => {
    const url = writeTopmanUiModeToUrl('simple', new URL('https://example.test/dashboard?view=asia'));
    assert.equal(url.searchParams.get('mode'), 'simple');
    assert.equal(url.searchParams.get('view'), 'asia');
  });
});
