import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SIMPLE_MAP_CATEGORIES,
  buildSimpleMapLayers,
  getDefaultSimpleMapCategoryIds,
} from '../src/services/topman-simple-map.ts';
import type { MapLayers } from '../src/types/index.ts';

function emptyLayers(): MapLayers {
  return {
    conflicts: false,
    bases: false,
    cables: false,
    pipelines: false,
    storageFacilities: false,
    fuelShortages: false,
    hotspots: false,
    ais: false,
    nuclear: false,
    irradiators: false,
    radiationWatch: false,
    sanctions: false,
    weather: false,
    economic: false,
    waterways: false,
    outages: false,
    cyberThreats: false,
    datacenters: false,
    protests: false,
    flights: false,
    military: false,
    natural: false,
    spaceports: false,
    minerals: false,
    fires: false,
    ucdpEvents: false,
    displacement: false,
    climate: false,
    startupHubs: false,
    cloudRegions: false,
    accelerators: false,
    techHQs: false,
    techEvents: false,
    stockExchanges: false,
    financialCenters: false,
    centralBanks: false,
    commodityHubs: false,
    gulfInvestments: false,
    positiveEvents: false,
    kindness: false,
    happiness: false,
    speciesRecovery: false,
    renewableInstallations: false,
    tradeRoutes: false,
    iranAttacks: false,
    gpsJamming: false,
    satellites: false,
    ciiChoropleth: false,
    resilienceScore: false,
    commodityPorts: false,
    liveTankers: false,
    webcams: false,
  } as MapLayers;
}

describe('topman-simple-map', () => {
  it('exposes at most five human categories', () => {
    assert.equal(SIMPLE_MAP_CATEGORIES.length, 5);
  });

  it('enables only selected category layers', () => {
    const layers = buildSimpleMapLayers(['conflict', 'weather'], emptyLayers());
    assert.equal(layers.conflicts, true);
    assert.equal(layers.hotspots, true);
    assert.equal(layers.weather, true);
    assert.equal(layers.climate, true);
    assert.equal(layers.natural, false);
    assert.equal(layers.pipelines, false);
    assert.equal(layers.military, false);
  });

  it('defaults to a small subset for first paint', () => {
    const defaults = getDefaultSimpleMapCategoryIds();
    assert.ok(defaults.length <= 5);
    assert.ok(defaults.includes('conflict'));
    assert.ok(defaults.includes('disaster') || defaults.includes('weather'));
  });
});
