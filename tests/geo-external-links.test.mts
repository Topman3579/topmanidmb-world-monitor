import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildGoogleEarthUrl,
  buildGoogleMapsUrl,
  extractCoordinatesFromUnknown,
  isValidGeoCoordinate,
  renderGeoExploreLinks,
} from '../src/utils/geo-external-links.ts';

describe('geo-external-links', () => {
  it('validates coordinate ranges', () => {
    assert.equal(isValidGeoCoordinate(13.75, 100.5), true);
    assert.equal(isValidGeoCoordinate(91, 0), false);
    assert.equal(isValidGeoCoordinate(0, 181), false);
  });

  it('builds Google Earth and Maps URLs with fixed precision', () => {
    const earth = buildGoogleEarthUrl(13.7563, 100.5018, 2000);
    assert.match(earth, /^https:\/\/earth\.google\.com\/web\/@13\.756300,100\.501800,2000a,/);
    const maps = buildGoogleMapsUrl(13.7563, 100.5018, 15);
    assert.equal(maps, 'https://www.google.com/maps?q=13.756300,100.501800&z=15');
  });

  it('extracts lat/lon from common popup shapes', () => {
    assert.deepEqual(extractCoordinatesFromUnknown({ lat: 1, lon: 2 }), { lat: 1, lon: 2 });
    assert.deepEqual(extractCoordinatesFromUnknown({ lat: 1, lng: 2 }), { lat: 1, lon: 2 });
    assert.deepEqual(
      extractCoordinatesFromUnknown({ latitude: 10.5, longitude: 99.1 }),
      { lat: 10.5, lon: 99.1 },
    );
    assert.deepEqual(
      extractCoordinatesFromUnknown({ location: { lat: 5, lon: 6 } }),
      { lat: 5, lon: 6 },
    );
    // GeoJSON [lon, lat]
    assert.deepEqual(
      extractCoordinatesFromUnknown({ coordinates: [100.5, 13.7] }),
      { lat: 13.7, lon: 100.5 },
    );
  });

  it('averages cluster item coordinates', () => {
    const c = extractCoordinatesFromUnknown({
      items: [
        { lat: 10, lon: 100 },
        { lat: 12, lon: 102 },
      ],
    });
    assert.ok(c);
    assert.equal(c!.lat, 11);
    assert.equal(c!.lon, 101);
  });

  it('returns null for missing coords', () => {
    assert.equal(extractCoordinatesFromUnknown({ name: 'x' }), null);
    assert.equal(extractCoordinatesFromUnknown(null), null);
  });

  it('renders explore HTML with both outbound links', () => {
    const html = renderGeoExploreLinks(13.7, 100.5);
    assert.match(html, /data-geo-explore="1"/);
    assert.match(html, /earth\.google\.com/);
    assert.match(html, /google\.com\/maps\?q=13\.700000,100\.500000/);
    assert.match(html, /data-geo-action="earth"/);
    assert.match(html, /data-geo-action="maps"/);
  });
});
