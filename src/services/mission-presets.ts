import type { MapLayers, PanelConfig } from '@/types';
import {
  ALL_PANELS,
  DEFAULT_MAP_LAYERS,
  DEFAULT_PANELS,
  VARIANT_DEFAULTS,
  getEffectivePanelConfig,
} from '@/config/panels';
import { SITE_VARIANT } from '@/config/variant';
import { isLayerExecutable, sanitizeLayersForVariant } from '@/config/map-layer-definitions';
import type { MapRenderer, MapVariant } from '@/config/map-layer-definitions';
import { topmanText } from '@/services/topman-language-mode';

export const MISSION_PRESET_STORAGE_KEY = 'worldmonitor-mission-preset-v1';
export const TOPMAN_MISSION_PRESET_STORAGE_KEY = 'worldmonitor-mission-preset-v2';
export const MISSION_PRESET_DISMISSED_KEY = 'worldmonitor-mission-preset-dismissed-v1';

export type LegacyMissionPresetId =
  | 'crisis-desk'
  | 'supply-chain-risk'
  | 'energy-security'
  | 'osint-newsroom'
  | 'macro-market-watch'
  | 'tech-ai-watch'
  | 'good-news-explorer';

export type TopmanCoreMissionPresetId =
  | 'topman-thailand-asean'
  | 'topman-disaster-weather'
  | 'topman-energy-commodities'
  | 'topman-news-conflict'
  | 'topman-finance-radar'
  | 'topman-aviation-routes';

export type MissionPresetId = LegacyMissionPresetId | TopmanCoreMissionPresetId;

export type MissionMapView = 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';
export type MissionTimeRange = '1h' | '6h' | '24h' | '48h' | '7d' | 'all';

export interface MissionPreset {
  id: MissionPresetId;
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
  view: MissionMapView;
  zoom?: number;
  timeRange: MissionTimeRange;
  panels: string[];
  layers: Array<keyof MapLayers>;
}

export interface AppliedMissionPreset {
  preset: MissionPreset;
  panelSettings: Record<string, PanelConfig>;
  panelOrder: string[];
  mapLayers: MapLayers;
}

export interface ResetMissionPresetState {
  panelSettings: Record<string, PanelConfig>;
  panelOrder: string[];
  mapLayers: MapLayers;
}

export const TOPMAN_CORE_MISSION_PRESETS: readonly MissionPreset[] = [
  {
    id: 'topman-thailand-asean',
    label: topmanText('ไทยและอาเซียน', 'Thailand & ASEAN'),
    shortLabel: topmanText('อาเซียน', 'ASEAN'),
    description: topmanText(
      'ติดตามข่าว ความเสี่ยง ภัยพิบัติ และสัญญาณสำคัญรอบประเทศไทย',
      'News, risk, disasters, and priority signals around Thailand.',
    ),
    icon: 'TH',
    view: 'asia',
    zoom: 3.4,
    timeRange: '24h',
    panels: [
      'map',
      'live-news',
      'asia',
      'insights',
      'strategic-risk',
      'gdelt-intel',
      'disaster-correlation',
      'security-advisories',
      'world-clock',
    ],
    layers: [
      'hotspots',
      'conflicts',
      'weather',
      'natural',
    ],
  },
  {
    id: 'topman-disaster-weather',
    label: topmanText('ภัยพิบัติและสภาพอากาศ', 'Disaster & Weather'),
    shortLabel: topmanText('ภัยพิบัติ', 'Disaster'),
    description: topmanText(
      'แผ่นดินไหว พายุ ไฟป่า ภูมิอากาศ และผลกระทบต่อประชาชน',
      'Earthquakes, storms, fires, climate, and population exposure.',
    ),
    icon: 'WX',
    view: 'global',
    zoom: 2.2,
    timeRange: '48h',
    panels: [
      'map',
      'live-news',
      'disaster-correlation',
      'satellite-fires',
      'climate',
      'population-exposure',
      'security-advisories',
      'disease-outbreaks',
    ],
    layers: [
      'weather',
      'natural',
      'fires',
      'climate',
    ],
  },
  {
    id: 'topman-energy-commodities',
    label: topmanText('พลังงานและสินค้าโภคภัณฑ์', 'Energy & Commodities'),
    shortLabel: topmanText('พลังงาน', 'Energy'),
    description: topmanText(
      'น้ำมัน ก๊าซ โลหะ เส้นทางขนส่ง และความเสี่ยงด้านพลังงาน',
      'Oil, gas, metals, trade routes, and energy disruption risk.',
    ),
    icon: 'EN',
    view: 'global',
    zoom: 2.4,
    timeRange: '7d',
    panels: [
      'map',
      'live-news',
      'energy-complex',
      'commodities',
      'pipeline-status',
      'oil-inventories',
      'energy-disruptions',
      'energy-risk-overview',
      'supply-chain',
    ],
    layers: [
      'pipelines',
      'tradeRoutes',
      'waterways',
      'weather',
      'natural',
    ],
  },
  {
    id: 'topman-news-conflict',
    label: topmanText('ข่าวและความขัดแย้ง', 'News & Conflict'),
    shortLabel: topmanText('ข่าว', 'News'),
    description: topmanText(
      'ข่าวเร่งด่วน เหตุขัดแย้ง การประท้วง และสัญญาณข่าวกรองข้ามแหล่ง',
      'Breaking news, conflicts, protests, and cross-source intelligence.',
    ),
    icon: 'OS',
    view: 'global',
    zoom: 2.1,
    timeRange: '24h',
    panels: [
      'map',
      'live-news',
      'gdelt-intel',
      'intel',
      'threat-timeline',
      'strategic-risk',
      'ucdp-events',
      'cross-source-signals',
      'politics',
      'security-advisories',
    ],
    layers: [
      'conflicts',
      'hotspots',
      'protests',
      'ucdpEvents',
      'military',
    ],
  },
  {
    id: 'topman-finance-radar',
    label: topmanText('เรดาร์ตลาดการเงิน', 'Financial Market Radar'),
    shortLabel: topmanText('ตลาด', 'Markets'),
    description: topmanText(
      'ตลาดหุ้น ภาวะมหภาค ความเชื่อมั่น และสินค้าโภคภัณฑ์',
      'Equities, macro conditions, sentiment, and commodities.',
    ),
    icon: 'FX',
    view: 'global',
    zoom: 2.3,
    timeRange: '7d',
    panels: [
      'map',
      'live-news',
      'markets',
      'heatmap',
      'macro-signals',
      'market-breadth',
      'fear-greed',
      'commodities',
      'economic',
    ],
    layers: [
      'economic',
      'tradeRoutes',
      'waterways',
      'pipelines',
      'sanctions',
    ],
  },
  {
    id: 'topman-aviation-routes',
    label: topmanText('การบินและเส้นทางเดินทาง', 'Aviation & Routes'),
    shortLabel: topmanText('การบิน', 'Aviation'),
    description: topmanText(
      'สถานะเที่ยวบิน สภาพอากาศ ความเสี่ยงเส้นทาง และข้อมูลสายการบิน',
      'Flight status, weather, route risk, and airline intelligence.',
    ),
    icon: 'AV',
    view: 'global',
    zoom: 2.5,
    timeRange: '24h',
    panels: [
      'map',
      'live-news',
      'airline-intel',
      'world-clock',
      'security-advisories',
      'strategic-risk',
      'asia',
      'europe',
    ],
    layers: [
      'flights',
      'weather',
      'natural',
      'conflicts',
      'outages',
    ],
  },
];

/**
 * Original v1 presets. Their IDs and meanings are intentionally immutable:
 * existing users may still have one of these IDs stored under the v1 key.
 */
export const MISSION_PRESETS: readonly MissionPreset[] = [
  {
    id: 'crisis-desk',
    label: 'Crisis Desk',
    shortLabel: 'Crisis',
    description: 'Conflict, posture, instability, and live intelligence.',
    icon: '!',
    view: 'mena',
    zoom: 3.6,
    timeRange: '24h',
    panels: [
      'map',
      'live-news',
      'insights',
      'strategic-posture',
      'cii',
      'strategic-risk',
      'gdelt-intel',
      'cascade',
      'military-correlation',
      'escalation-correlation',
      'ucdp-events',
      'security-advisories',
      'airline-intel',
    ],
    layers: [
      'conflicts',
      'hotspots',
      'military',
      'bases',
      'iranAttacks',
      'ucdpEvents',
      'protests',
      'sanctions',
      'outages',
      'weather',
      'natural',
      'ciiChoropleth',
    ],
  },
  {
    id: 'supply-chain-risk',
    label: 'Supply-Chain Risk',
    shortLabel: 'Supply',
    description: 'Routes, chokepoints, country risk, and commodities.',
    icon: 'S',
    view: 'global',
    zoom: 2.3,
    timeRange: '7d',
    panels: [
      'map',
      'supply-chain',
      'chokepoint-strip',
      'hormuz-tracker',
      'cascade',
      'strategic-risk',
      'cii',
      'commodities',
      'energy-complex',
      'markets',
      'consumer-prices',
    ],
    layers: [
      'tradeRoutes',
      'waterways',
      'ais',
      'cables',
      'pipelines',
      'commodityHubs',
      'commodityPorts',
      'minerals',
      'economic',
      'sanctions',
      'weather',
      'natural',
      'resilienceScore',
    ],
  },
  {
    id: 'energy-security',
    label: 'Energy Security',
    shortLabel: 'Energy',
    description: 'Pipelines, storage, tankers, outages, and disruption logs.',
    icon: 'E',
    view: 'mena',
    zoom: 3.2,
    timeRange: '7d',
    panels: [
      'map',
      'energy-complex',
      'oil-inventories',
      'energy-crisis',
      'pipeline-status',
      'storage-facility-map',
      'fuel-shortages',
      'energy-disruptions',
      'energy-risk-overview',
      'hormuz-tracker',
      'chokepoint-strip',
      'supply-chain',
    ],
    layers: [
      'pipelines',
      'storageFacilities',
      'fuelShortages',
      'liveTankers',
      'ais',
      'tradeRoutes',
      'waterways',
      'commodityPorts',
      'commodityHubs',
      'sanctions',
      'fires',
      'weather',
      'outages',
      'natural',
    ],
  },
  {
    id: 'osint-newsroom',
    label: 'News Seeker',
    shortLabel: 'News',
    description: 'Breaking news, source context, webcams, advisories, and social signal.',
    icon: 'N',
    view: 'global',
    zoom: 2.1,
    timeRange: '24h',
    panels: [
      'map',
      'live-news',
      'gdelt-intel',
      'intel',
      'politics',
      'middleeast',
      'europe',
      'africa',
      'latam',
      'asia',
      'us',
      'social-velocity',
      'live-webcams',
      'security-advisories',
    ],
    layers: [
      'hotspots',
      'conflicts',
      'protests',
      'ucdpEvents',
      'displacement',
      'outages',
      'cyberThreats',
      'webcams',
      'weather',
      'natural',
      'fires',
    ],
  },
  {
    id: 'macro-market-watch',
    label: 'Stock Geek',
    shortLabel: 'Stocks',
    description: 'Stocks, market breadth, earnings, macro signals, and event context.',
    icon: '$',
    view: 'america',
    zoom: 3,
    timeRange: '7d',
    panels: [
      'map',
      'markets',
      'heatmap',
      'market-breadth',
      'earnings-calendar',
      'macro-signals',
      'fear-greed',
      'economic',
      'liquidity-shifts',
      'positioning-247',
      'commodities',
      'energy-complex',
      'consumer-prices',
      'gold-intelligence',
      'etf-flows',
      'stablecoins',
      'crypto',
      'finance',
      'economic-calendar',
    ],
    layers: [
      'stockExchanges',
      'financialCenters',
      'centralBanks',
      'commodityHubs',
      'gulfInvestments',
      'economic',
      'tradeRoutes',
      'pipelines',
      'waterways',
      'sanctions',
      'outages',
      'weather',
      'natural',
    ],
  },
  {
    id: 'tech-ai-watch',
    label: 'Tech / AI Watcher',
    shortLabel: 'Tech',
    description: 'AI labs, startups, chips, cloud, cyber, and regulation signals.',
    icon: 'T',
    view: 'global',
    zoom: 2.4,
    timeRange: '7d',
    panels: [
      'map',
      'live-news',
      'insights',
      'ai',
      'tech',
      'startups',
      'security',
      'policy',
      'hardware',
      'cloud',
      'github',
      'tech-readiness',
      'funding',
      'unicorns',
      'accelerators',
      'events',
      'markets',
      'internet-disruptions',
      'service-status',
      'monitors',
    ],
    layers: [
      'datacenters',
      'startupHubs',
      'techHQs',
      'techEvents',
      'cloudRegions',
      'cables',
      'outages',
      'cyberThreats',
      'natural',
    ],
  },
  {
    id: 'good-news-explorer',
    label: 'Good News Explorer',
    shortLabel: 'Good',
    description: 'Progress, breakthroughs, conservation wins, and clean-energy momentum.',
    icon: '+',
    view: 'global',
    zoom: 2.2,
    timeRange: '7d',
    panels: [
      'map',
      'positive-feed',
      'progress',
      'counters',
      'spotlight',
      'breakthroughs',
      'digest',
      'species',
      'renewable',
    ],
    layers: [
      'positiveEvents',
      'kindness',
      'happiness',
      'speciesRecovery',
      'renewableInstallations',
    ],
  },
];

const DYNAMIC_PANEL_PREFIXES = ['cw-', 'mcp-'];
const MIN_PRESET_PANEL_MATCHES = 2;

const isDynamicPanel = (key: string): boolean =>
  key === 'runtime-config' || DYNAMIC_PANEL_PREFIXES.some((prefix) => key.startsWith(prefix));

const getVariantDefaultPanels = (variant: string): string[] =>
  VARIANT_DEFAULTS[variant] ?? VARIANT_DEFAULTS.full ?? [];

const hasAnyActiveLayer = (layers: MapLayers): boolean =>
  Object.values(layers).some(Boolean);

const withMapPanel = (panels: string[]): string[] => {
  const ordered = ['map', ...panels.filter((key) => key !== 'map')];
  return Array.from(new Set(ordered));
};

const LEGACY_MISSION_PRESET_IDS = new Set<MissionPresetId>(
  MISSION_PRESETS.map((preset) => preset.id),
);
const TOPMAN_CORE_MISSION_PRESET_IDS = new Set<MissionPresetId>(
  TOPMAN_CORE_MISSION_PRESETS.map((preset) => preset.id),
);

export function isTopmanCoreMissionPresetId(
  id: string | null | undefined,
): id is TopmanCoreMissionPresetId {
  return !!id && TOPMAN_CORE_MISSION_PRESET_IDS.has(id as MissionPresetId);
}

export function getMissionPresetsForVariant(variant: string = SITE_VARIANT): readonly MissionPreset[] {
  return variant === 'full' ? TOPMAN_CORE_MISSION_PRESETS : MISSION_PRESETS;
}

export function getMissionPreset(id: string | null | undefined): MissionPreset | null {
  if (!id) return null;
  return TOPMAN_CORE_MISSION_PRESETS.find((preset) => preset.id === id)
    ?? MISSION_PRESETS.find((preset) => preset.id === id)
    ?? null;
}

export function loadStoredMissionPreset(variant: string = SITE_VARIANT): MissionPreset | null {
  try {
    if (variant === 'full') {
      const topmanId = localStorage.getItem(TOPMAN_MISSION_PRESET_STORAGE_KEY);
      if (isTopmanCoreMissionPresetId(topmanId)) {
        return getMissionPreset(topmanId);
      }
    }

    const legacyId = localStorage.getItem(MISSION_PRESET_STORAGE_KEY);
    return legacyId && LEGACY_MISSION_PRESET_IDS.has(legacyId as MissionPresetId)
      ? getMissionPreset(legacyId)
      : null;
  } catch {
    return null;
  }
}

export function saveMissionPreset(id: MissionPresetId, variant: string = SITE_VARIANT): void {
  if (isTopmanCoreMissionPresetId(id) && variant !== 'full') {
    throw new Error(`TOPMAN core mission preset "${id}" is only available in the full variant`);
  }

  try {
    if (isTopmanCoreMissionPresetId(id)) {
      localStorage.setItem(TOPMAN_MISSION_PRESET_STORAGE_KEY, id);
    } else {
      localStorage.setItem(MISSION_PRESET_STORAGE_KEY, id);
      if (variant === 'full') {
        localStorage.removeItem(TOPMAN_MISSION_PRESET_STORAGE_KEY);
      }
    }
    localStorage.setItem(MISSION_PRESET_DISMISSED_KEY, '1');
  } catch {
    // Storage can be unavailable in private mode; preset application still works for this session.
  }
}

export function clearMissionPreset(variant: string = SITE_VARIANT): void {
  try {
    localStorage.removeItem(MISSION_PRESET_STORAGE_KEY);
    if (variant === 'full') {
      localStorage.removeItem(TOPMAN_MISSION_PRESET_STORAGE_KEY);
    }
    localStorage.setItem(MISSION_PRESET_DISMISSED_KEY, '1');
  } catch {
    // Ignore storage failures.
  }
}

export function isMissionPresetPromptDismissed(): boolean {
  try {
    return localStorage.getItem(MISSION_PRESET_DISMISSED_KEY) === '1';
  } catch {
    return true;
  }
}

export function dismissMissionPresetPrompt(): void {
  try {
    localStorage.setItem(MISSION_PRESET_DISMISSED_KEY, '1');
  } catch {
    // Ignore storage failures.
  }
}

export function applyMissionPresetToState(
  presetId: MissionPresetId,
  currentPanelSettings: Record<string, PanelConfig>,
  defaultLayers: MapLayers = DEFAULT_MAP_LAYERS,
  variant: string = SITE_VARIANT,
): AppliedMissionPreset {
  const preset = getMissionPreset(presetId);
  if (!preset) throw new Error(`Unknown mission preset: ${presetId}`);
  if (isTopmanCoreMissionPresetId(preset.id) && variant !== 'full') {
    throw new Error(`TOPMAN core mission preset "${preset.id}" is only available in the full variant`);
  }

  const variantPanels = getVariantDefaultPanels(variant);
  const variantPanelSet = new Set(variantPanels);
  const matchingPresetPanels = preset.panels.filter((key) => key !== 'map' && variantPanelSet.has(key));
  const useVariantDefaultPanels = matchingPresetPanels.length < MIN_PRESET_PANEL_MATCHES;
  const selectedPanels = useVariantDefaultPanels
    ? withMapPanel(variantPanels)
    : preset.panels.filter((key) => key === 'map' || variantPanelSet.has(key));
  const selectedPanelSet = new Set(selectedPanels);
  const nextPanelSettings: Record<string, PanelConfig> = {};
  const allKeys = new Set([
    ...Object.keys(DEFAULT_PANELS),
    ...Object.keys(ALL_PANELS),
    ...Object.keys(currentPanelSettings),
    ...selectedPanels,
  ]);

  for (const key of allKeys) {
    const current = currentPanelSettings[key];
    const resolved = ALL_PANELS[key] ? getEffectivePanelConfig(key, variant) : current;
    if (!resolved) continue;

    if (isDynamicPanel(key)) {
      nextPanelSettings[key] = { ...resolved };
      continue;
    }

    const isKnownPanel = key === 'map' || !!ALL_PANELS[key] || !!current;
    if (!isKnownPanel) continue;

    const shouldEnable = selectedPanelSet.has(key);
    let enabled = shouldEnable;
    if (key === 'map') {
      enabled = true;
    } else if (useVariantDefaultPanels) {
      enabled = shouldEnable && resolved.enabled !== false;
    }

    nextPanelSettings[key] = {
      ...resolved,
      enabled,
    };
  }

  const candidateLayers: MapLayers = { ...defaultLayers };
  for (const key of Object.keys(candidateLayers) as Array<keyof MapLayers>) {
    candidateLayers[key] = false;
  }
  for (const key of preset.layers) {
    candidateLayers[key] = true;
  }

  let mapLayers = sanitizeLayersForVariant(candidateLayers, variant as MapVariant);
  if (!hasAnyActiveLayer(mapLayers)) {
    mapLayers = sanitizeLayersForVariant({ ...defaultLayers }, variant as MapVariant);
  }

  return {
    preset,
    panelSettings: nextPanelSettings,
    panelOrder: selectedPanels.filter((key) => key !== 'map'),
    mapLayers,
  };
}

export function resetMissionPresetState(
  currentPanelSettings: Record<string, PanelConfig>,
  defaultLayers: MapLayers = DEFAULT_MAP_LAYERS,
  variant: string = SITE_VARIANT,
): ResetMissionPresetState {
  const variantPanels = VARIANT_DEFAULTS[variant] ?? VARIANT_DEFAULTS.full ?? [];
  const variantPanelSet = new Set(variantPanels);
  const nextPanelSettings: Record<string, PanelConfig> = {};
  const allKeys = new Set([
    ...Object.keys(DEFAULT_PANELS),
    ...Object.keys(ALL_PANELS),
    ...Object.keys(currentPanelSettings),
  ]);

  for (const key of allKeys) {
    const current = currentPanelSettings[key];
    const resolved = ALL_PANELS[key] ? getEffectivePanelConfig(key, variant) : current;
    if (!resolved) continue;
    if (isDynamicPanel(key)) {
      nextPanelSettings[key] = { ...resolved };
      continue;
    }
    nextPanelSettings[key] = {
      ...resolved,
      enabled: key === 'map' || (variantPanelSet.has(key) && resolved.enabled !== false),
    };
  }

  return {
    panelSettings: nextPanelSettings,
    panelOrder: variantPanels.filter((key) => key !== 'map'),
    mapLayers: sanitizeLayersForVariant({ ...defaultLayers }, variant as MapVariant),
  };
}

export function filterMissionLayersForRenderer(
  layers: MapLayers,
  renderer: MapRenderer,
  isDeckGLActive: boolean,
  fallbackLayers: MapLayers = DEFAULT_MAP_LAYERS,
): MapLayers {
  const filter = (candidateLayers: MapLayers): MapLayers => {
    const next = { ...candidateLayers };
    for (const key of Object.keys(next) as Array<keyof MapLayers>) {
      if (next[key] && !isLayerExecutable(key, renderer, isDeckGLActive)) {
        next[key] = false;
      }
    }
    return next;
  };

  const next = filter(layers);
  return hasAnyActiveLayer(next) ? next : filter(fallbackLayers);
}
