import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TOPMAN_PRO_DESK_DEFS,
  buildTopmanProDesksState,
} from '../src/services/topman-pro-desks.ts';
import { DEFAULT_MAP_LAYERS, DEFAULT_PANELS } from '../src/config/panels.ts';

describe('topman-pro-desks', () => {
  it('defines exactly four briefing desks', () => {
    assert.equal(TOPMAN_PRO_DESK_DEFS.length, 4);
    assert.deepEqual(
      TOPMAN_PRO_DESK_DEFS.map((d) => d.deskKey),
      ['th-asean', 'disaster', 'energy', 'markets'],
    );
  });

  it('builds four named tabs with panels enabled from missions', () => {
    const built = buildTopmanProDesksState(
      { ...DEFAULT_PANELS },
      { ...DEFAULT_MAP_LAYERS },
      'full',
    );
    assert.equal(built.tabsState.tabs.length, 4);
    assert.equal(built.tabsState.activeTabId, built.tabsState.tabs[0]!.id);
    assert.ok(built.deskNames[0]!.includes('ไทย') || built.deskNames[0]!.includes('TH'));
    // Active desk should have map + at least one intel panel enabled
    const settings = built.tabsState.tabs[0]!.panelSettings;
    assert.equal(settings.map?.enabled, true);
    const enabledCount = Object.values(settings).filter((p) => p.enabled).length;
    assert.ok(enabledCount >= 4, `expected several panels, got ${enabledCount}`);
    assert.ok(Object.values(built.activeMapLayers).some(Boolean));
  });

  it('rejects non-full variants', () => {
    assert.throws(
      () => buildTopmanProDesksState({}, { ...DEFAULT_MAP_LAYERS }, 'tech'),
      /full variant/,
    );
  });
});
