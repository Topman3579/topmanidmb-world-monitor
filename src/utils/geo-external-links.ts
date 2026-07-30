/**
 * External geo viewers (Google Earth / Maps) for map-popup deep-dives.
 * Opens third-party apps via URL only — does not scrape or embed Google tiles.
 */

import { escapeHtml } from '@/utils/sanitize';
import { topmanText } from '@/services/topman-language-mode';

export interface GeoCoordinates {
  lat: number;
  lon: number;
}

export function isValidGeoCoordinate(lat: unknown, lon: unknown): lat is number {
  return typeof lat === 'number'
    && typeof lon === 'number'
    && Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= -90
    && lat <= 90
    && lon >= -180
    && lon <= 180;
}

/** Google Earth Web camera at lat/lon (public free web UI). */
export function buildGoogleEarthUrl(lat: number, lon: number, altitudeM = 2500): string {
  const la = lat.toFixed(6);
  const lo = lon.toFixed(6);
  // Format: @lat,lon,altitude a,distance,heading,tilt,roll
  return `https://earth.google.com/web/@${la},${lo},${altitudeM}a,${Math.max(800, altitudeM * 2)}d,35y,0h,0t,0r`;
}

/** Google Maps pin at lat/lon (public free web UI). */
export function buildGoogleMapsUrl(lat: number, lon: number, zoom = 14): string {
  const la = lat.toFixed(6);
  const lo = lon.toFixed(6);
  const z = Math.min(20, Math.max(3, Math.round(zoom)));
  return `https://www.google.com/maps?q=${la},${lo}&z=${z}`;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Best-effort lat/lon from heterogeneous map popup payloads.
 * Returns null when coordinates are missing or out of range.
 */
export function extractCoordinatesFromUnknown(data: unknown): GeoCoordinates | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  const pairs: Array<[unknown, unknown]> = [
    [obj.lat, obj.lon],
    [obj.lat, obj.lng],
    [obj.latitude, obj.longitude],
    [obj.centerLat, obj.centerLon],
    [obj.center_lat, obj.center_lon],
  ];

  for (const [a, b] of pairs) {
    const lat = readNumber(a);
    const lon = readNumber(b);
    if (lat !== null && lon !== null && isValidGeoCoordinate(lat, lon)) {
      return { lat, lon };
    }
  }

  // Nested location / center
  for (const key of ['location', 'center', 'position', 'coordinates']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const found = extractCoordinatesFromUnknown(nested);
      if (found) return found;
    }
    if (Array.isArray(nested) && nested.length >= 2) {
      // GeoJSON-style [lon, lat] or [lat, lon] — prefer lon-first if |x|>90
      const n0 = readNumber(nested[0]);
      const n1 = readNumber(nested[1]);
      if (n0 !== null && n1 !== null) {
        if (isValidGeoCoordinate(n1, n0) && Math.abs(n0) > 90) {
          return { lat: n1, lon: n0 };
        }
        if (isValidGeoCoordinate(n0, n1)) {
          return { lat: n0, lon: n1 };
        }
        if (isValidGeoCoordinate(n1, n0)) {
          return { lat: n1, lon: n0 };
        }
      }
    }
  }

  // Cluster: average first few items with coords
  const items = obj.items;
  if (Array.isArray(items) && items.length > 0) {
    const coords: GeoCoordinates[] = [];
    for (const item of items.slice(0, 12)) {
      const c = extractCoordinatesFromUnknown(item);
      if (c) coords.push(c);
    }
    if (coords.length > 0) {
      const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
      const lon = coords.reduce((s, c) => s + c.lon, 0) / coords.length;
      if (isValidGeoCoordinate(lat, lon)) return { lat, lon };
    }
  }

  return null;
}

/** HTML block for map popups — Thai-first labels. */
export function renderGeoExploreLinks(
  lat: number,
  lon: number,
  options: { altitudeM?: number; mapsZoom?: number } = {},
): string {
  if (!isValidGeoCoordinate(lat, lon)) return '';

  const earthUrl = buildGoogleEarthUrl(lat, lon, options.altitudeM ?? 2500);
  const mapsUrl = buildGoogleMapsUrl(lat, lon, options.mapsZoom ?? 14);
  const heading = topmanText('ดูรายละเอียดภูมิประเทศ', 'Explore terrain');
  const earthLabel = topmanText('Google Earth', 'Google Earth');
  const mapsLabel = topmanText('Google Maps', 'Google Maps');
  const coordsLabel = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const hint = topmanText(
    'เปิดแท็บใหม่ · ฟรีบนเว็บ Google',
    'Opens a new tab · free Google web apps',
  );

  return `
    <div class="popup-geo-explore" data-geo-explore="1">
      <div class="popup-geo-explore__head">
        <span class="popup-geo-explore__title">${escapeHtml(heading)}</span>
        <span class="popup-geo-explore__coords" title="${escapeHtml(coordsLabel)}">${escapeHtml(coordsLabel)}</span>
      </div>
      <div class="popup-geo-explore__actions">
        <a class="popup-geo-explore__btn popup-geo-explore__btn--earth"
           href="${escapeHtml(earthUrl)}"
           target="_blank"
           rel="noopener noreferrer nofollow"
           data-geo-action="earth">${escapeHtml(earthLabel)} →</a>
        <a class="popup-geo-explore__btn popup-geo-explore__btn--maps"
           href="${escapeHtml(mapsUrl)}"
           target="_blank"
           rel="noopener noreferrer nofollow"
           data-geo-action="maps">${escapeHtml(mapsLabel)} →</a>
      </div>
      <p class="popup-geo-explore__hint">${escapeHtml(hint)}</p>
    </div>
  `;
}
