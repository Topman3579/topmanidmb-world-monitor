/**
 * TOPMAN Pro Business "desks" — four named dashboard tabs for command briefing.
 * Built from existing mission presets + panel apply pipeline (no new data APIs).
 */

import type { MapLayers, PanelConfig } from '@/types';
import {
  applyMissionPresetToState,
  type MissionPresetId,
  type TopmanCoreMissionPresetId,
} from '@/services/mission-presets';
import {
  generateTabId,
  type PanelTab,
  type TabsState,
} from '@/services/tab-store';
import { SITE_VARIANT } from '@/config/variant';
import { topmanText } from '@/services/topman-language-mode';

export const TOPMAN_PRO_DESKS_SEEDED_KEY = 'topman-pro-desks-seeded-v1';

export interface TopmanProDeskDef {
  /** Stable desk key (not the runtime tab id). */
  deskKey: string;
  /** Mission preset driving panels + layers for this desk. */
  missionId: TopmanCoreMissionPresetId;
  nameTh: string;
  nameEn: string;
}

/** Four command desks — maps 1:1 to TOPMAN core missions used most for briefing. */
export const TOPMAN_PRO_DESK_DEFS: readonly TopmanProDeskDef[] = [
  {
    deskKey: 'th-asean',
    missionId: 'topman-thailand-asean',
    nameTh: '01 · ไทย–อาเซียน',
    nameEn: '01 · TH–ASEAN',
  },
  {
    deskKey: 'disaster',
    missionId: 'topman-disaster-weather',
    nameTh: '02 · ภัยพิบัติ–อากาศ',
    nameEn: '02 · Disaster–Weather',
  },
  {
    deskKey: 'energy',
    missionId: 'topman-energy-commodities',
    nameTh: '03 · พลังงาน–เส้นทาง',
    nameEn: '03 · Energy–Routes',
  },
  {
    deskKey: 'markets',
    missionId: 'topman-finance-radar',
    nameTh: '04 · ตลาด–เศรษฐกิจ',
    nameEn: '04 · Markets–Economy',
  },
];

export function getTopmanProDeskName(def: TopmanProDeskDef): string {
  return topmanText(def.nameTh, def.nameEn);
}

export interface BuiltTopmanProDesks {
  tabsState: TabsState;
  /** Map layers of the active (first) desk — apply once after install. */
  activeMapLayers: MapLayers;
  activeMissionId: MissionPresetId;
  deskNames: string[];
}

/**
 * Build a full tabs snapshot for the four Pro desks.
 * Does not write storage — caller persists + applies UI.
 */
export function buildTopmanProDesksState(
  currentPanelSettings: Record<string, PanelConfig>,
  defaultLayers: MapLayers,
  variant: string = SITE_VARIANT,
): BuiltTopmanProDesks {
  if (variant !== 'full') {
    throw new Error('TOPMAN Pro desks are only available in the full variant');
  }

  const tabs: PanelTab[] = [];
  let activeMapLayers = defaultLayers;
  let activeMissionId: MissionPresetId = TOPMAN_PRO_DESK_DEFS[0]!.missionId;
  const deskNames: string[] = [];

  for (let i = 0; i < TOPMAN_PRO_DESK_DEFS.length; i++) {
    const def = TOPMAN_PRO_DESK_DEFS[i]!;
    const applied = applyMissionPresetToState(
      def.missionId,
      currentPanelSettings,
      defaultLayers,
      variant,
    );
    const name = getTopmanProDeskName(def);
    deskNames.push(name);
    tabs.push({
      id: generateTabId(),
      name,
      panelSettings: applied.panelSettings,
      panelOrder: applied.panelOrder,
      bottomSet: [],
    });
    if (i === 0) {
      activeMapLayers = applied.mapLayers;
      activeMissionId = applied.preset.id;
    }
  }

  return {
    tabsState: {
      activeTabId: tabs[0]!.id,
      tabs,
    },
    activeMapLayers,
    activeMissionId,
    deskNames,
  };
}

export function isTopmanProDesksSeeded(): boolean {
  try {
    return localStorage.getItem(TOPMAN_PRO_DESKS_SEEDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTopmanProDesksSeeded(): void {
  try {
    localStorage.setItem(TOPMAN_PRO_DESKS_SEEDED_KEY, '1');
  } catch {
    // ignore
  }
}

export function clearTopmanProDesksSeededFlag(): void {
  try {
    localStorage.removeItem(TOPMAN_PRO_DESKS_SEEDED_KEY);
  } catch {
    // ignore
  }
}
