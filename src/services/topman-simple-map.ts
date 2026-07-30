import type { MapLayers } from '@/types';
import { topmanText } from '@/services/topman-language-mode';

/**
 * Five human-readable map categories for Simple Mode.
 * Each category maps to a small set of engine layers — never more than the
 * five chips are shown at once.
 */

export type SimpleMapCategoryId =
  | 'conflict'
  | 'disaster'
  | 'weather'
  | 'energy'
  | 'markets';

export interface SimpleMapCategory {
  id: SimpleMapCategoryId;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  layers: Array<keyof MapLayers>;
  /** Default on for first paint in simple mode */
  defaultEnabled: boolean;
}

interface SimpleMapCategoryDef {
  id: SimpleMapCategoryId;
  labelTh: string;
  labelEn: string;
  shortTh: string;
  shortEn: string;
  descTh: string;
  descEn: string;
  color: string;
  layers: Array<keyof MapLayers>;
  defaultEnabled: boolean;
}

const SIMPLE_MAP_CATEGORY_DEFS: readonly SimpleMapCategoryDef[] = [
  {
    id: 'conflict',
    labelTh: 'ความขัดแย้ง',
    labelEn: 'Conflict',
    shortTh: 'ขัดแย้ง',
    shortEn: 'Conflict',
    descTh: 'จุดร้อน เหตุขัดแย้ง และการประท้วงจากแหล่งสาธารณะ',
    descEn: 'Hotspots, conflicts, and protests from public sources',
    color: '#ff8b83',
    layers: ['conflicts', 'hotspots', 'protests'],
    defaultEnabled: true,
  },
  {
    id: 'disaster',
    labelTh: 'ภัยพิบัติ',
    labelEn: 'Disasters',
    shortTh: 'ภัยพิบัติ',
    shortEn: 'Disaster',
    descTh: 'แผ่นดินไหว ไฟป่า และเหตุการณ์ธรรมชาติ',
    descEn: 'Earthquakes, wildfires, and natural events',
    color: '#f6a55c',
    layers: ['natural', 'fires'],
    defaultEnabled: true,
  },
  {
    id: 'weather',
    labelTh: 'สภาพอากาศ',
    labelEn: 'Weather',
    shortTh: 'อากาศ',
    shortEn: 'Weather',
    descTh: 'คำเตือนสภาพอากาศและความผิดปกติทางภูมิอากาศ',
    descEn: 'Weather alerts and climate anomalies',
    color: '#8fd0ff',
    layers: ['weather', 'climate'],
    defaultEnabled: true,
  },
  {
    id: 'energy',
    labelTh: 'พลังงานและสินค้าโภคภัณฑ์',
    labelEn: 'Energy & Commodities',
    shortTh: 'พลังงาน',
    shortEn: 'Energy',
    descTh: 'ท่อส่ง เส้นทางค้า และจุดคอขวดพลังงาน',
    descEn: 'Pipelines, trade routes, and energy chokepoints',
    color: '#ffcb2d',
    layers: ['pipelines', 'tradeRoutes', 'waterways'],
    defaultEnabled: false,
  },
  {
    id: 'markets',
    labelTh: 'ตลาดและเศรษฐกิจ',
    labelEn: 'Markets & Economy',
    shortTh: 'ตลาด',
    shortEn: 'Markets',
    descTh: 'สัญญาณเศรษฐกิจและมาตรการคว่ำบาตรที่เกี่ยวข้อง',
    descEn: 'Economic signals and related sanctions pressure',
    color: '#72d9be',
    layers: ['economic', 'sanctions'],
    defaultEnabled: false,
  },
];

/** Live labels — call at render time so language mode stays correct. */
export function getSimpleMapCategories(): readonly SimpleMapCategory[] {
  return SIMPLE_MAP_CATEGORY_DEFS.map((def) => ({
    id: def.id,
    label: topmanText(def.labelTh, def.labelEn),
    shortLabel: topmanText(def.shortTh, def.shortEn),
    description: topmanText(def.descTh, def.descEn),
    color: def.color,
    layers: def.layers,
    defaultEnabled: def.defaultEnabled,
  }));
}

/** Static ids/layers for non-UI consumers (tests, layer building). */
export const SIMPLE_MAP_CATEGORIES: readonly SimpleMapCategory[] = getSimpleMapCategories();

export const SIMPLE_MAP_CATEGORY_STORAGE_KEY = 'topman-simple-map-categories-v1';

export function getDefaultSimpleMapCategoryIds(): SimpleMapCategoryId[] {
  return SIMPLE_MAP_CATEGORY_DEFS.filter((c) => c.defaultEnabled).map((c) => c.id);
}

export function loadStoredSimpleMapCategories(): SimpleMapCategoryId[] | null {
  try {
    const raw = localStorage.getItem(SIMPLE_MAP_CATEGORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const allowed = new Set(SIMPLE_MAP_CATEGORY_DEFS.map((c) => c.id));
    const ids = parsed.filter((id): id is SimpleMapCategoryId => typeof id === 'string' && allowed.has(id as SimpleMapCategoryId));
    return ids.length > 0 ? ids.slice(0, 5) : null;
  } catch {
    return null;
  }
}

export function saveSimpleMapCategories(ids: readonly SimpleMapCategoryId[]): void {
  try {
    localStorage.setItem(SIMPLE_MAP_CATEGORY_STORAGE_KEY, JSON.stringify(ids.slice(0, 5)));
  } catch {
    // ignore
  }
}

/** Build a full MapLayers object with only selected category layers on. */
export function buildSimpleMapLayers(
  enabledCategoryIds: readonly SimpleMapCategoryId[],
  base: MapLayers,
): MapLayers {
  const next: MapLayers = { ...base };
  for (const key of Object.keys(next) as Array<keyof MapLayers>) {
    next[key] = false as never;
  }

  const enabled = new Set(enabledCategoryIds);
  for (const category of SIMPLE_MAP_CATEGORY_DEFS) {
    if (!enabled.has(category.id)) continue;
    for (const layer of category.layers) {
      if (Object.prototype.hasOwnProperty.call(next, layer) || layer in next) {
        (next as unknown as Record<string, boolean>)[layer] = true;
      }
    }
  }

  return next;
}

export function describeSimpleMapLegend(enabledCategoryIds: readonly SimpleMapCategoryId[]): Array<{
  id: SimpleMapCategoryId;
  label: string;
  description: string;
  color: string;
}> {
  const enabled = new Set(enabledCategoryIds);
  return getSimpleMapCategories()
    .filter((c) => enabled.has(c.id))
    .map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      color: c.color,
    }));
}
