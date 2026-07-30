import { getMissionPresetsForVariant, type MissionPresetId } from '@/services/mission-presets';
import { SITE_VARIANT } from '@/config/variant';
import {
  fetchServerInsights,
  getServerInsights,
  type ServerInsights,
} from '@/services/insights-loader';
import {
  classifyTopmanHealthPayload,
  fetchTopmanHealthSnapshot,
  type TopmanHealthSnapshot,
} from '@/services/topman-health-status';
import { topmanText } from '@/services/topman-language-mode';
import {
  applyTopmanUiModeToDocument,
  resolveTopmanUiMode,
  setTopmanUiMode,
  type TopmanUiMode,
  TOPMAN_UI_MODE_EVENT,
} from '@/services/topman-ui-mode';
import {
  buildSimpleExecutiveSummary,
  formatSimpleDataStatusLabel,
  type SimpleExecutiveSummary,
  type SimpleSummaryCard,
} from '@/services/topman-simple-summary';
import {
  SIMPLE_MAP_CATEGORIES,
  buildSimpleMapLayers,
  describeSimpleMapLegend,
  getDefaultSimpleMapCategoryIds,
  loadStoredSimpleMapCategories,
  saveSimpleMapCategories,
  type SimpleMapCategoryId,
} from '@/services/topman-simple-map';
import {
  completeGuidedTour,
  dismissGuidedTour,
  getGuidedTourSteps,
  resetGuidedTour,
  shouldAutoStartGuidedTour,
  type GuidedTourStep,
} from '@/services/topman-guided-tour';
import { escapeHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import type { MapLayers } from '@/types';

// Re-export labels used by header toggle
export function getTopmanUiModeLabel(mode: TopmanUiMode): { short: string; full: string } {
  if (mode === 'simple') {
    return {
      short: topmanText('ใช้ง่าย', 'Simple'),
      full: topmanText('โหมดใช้ง่าย', 'Simple Mode'),
    };
  }
  return {
    short: topmanText('ผู้เชี่ยวชาญ', 'Advanced'),
    full: topmanText('โหมดผู้เชี่ยวชาญ', 'Advanced Mode'),
  };
}

export interface TopmanSimpleModeCallbacks {
  /** Apply a mission preset (existing engine path). */
  onApplyMission: (id: MissionPresetId) => void;
  /** Apply simplified map layers for selected categories. */
  onApplySimpleLayers: (layers: MapLayers) => void;
  /** Provide current base MapLayers template (all keys). */
  getBaseMapLayers: () => MapLayers;
  /** Jump to advanced view focused on a card. */
  onOpenCardDetail: (cardId: SimpleSummaryCard['id']) => void;
  /** Optional: active mission id for highlight. */
  getActiveMissionId?: () => string | null;
}

export class TopmanSimpleMode {
  private root: HTMLElement;
  private callbacks: TopmanSimpleModeCallbacks;
  private mode: TopmanUiMode;
  private summary: SimpleExecutiveSummary | null = null;
  private health: TopmanHealthSnapshot | null = null;
  private enabledCategories: SimpleMapCategoryId[];
  private tourOpen = false;
  private tourStep = 0;
  private destroyed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private boundModeListener: ((ev: Event) => void) | null = null;
  private boundRootClick: ((ev: MouseEvent) => void) | null = null;

  constructor(root: HTMLElement, callbacks: TopmanSimpleModeCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    // Prefer storage over transient map URL params so late init (after URL
    // rewrite) cannot flip Simple → Advanced just because layers= is present.
    this.mode = resolveTopmanUiMode();
    this.enabledCategories = loadStoredSimpleMapCategories() ?? getDefaultSimpleMapCategoryIds();
  }

  init(): void {
    this.root.classList.add('topman-simple-mode');
    this.root.setAttribute('data-topman-simple-root', '1');
    // Re-assert mode into document + URL after map URL sync may have rewritten the query.
    this.mode = setTopmanUiMode(this.mode, { updateUrl: true, dispatch: false });
    this.applyModeChrome();
    this.render();
    this.bindEvents();
    void this.refreshData();

    if (this.mode === 'simple' && shouldAutoStartGuidedTour()) {
      window.setTimeout(() => {
        if (!this.destroyed && this.mode === 'simple' && shouldAutoStartGuidedTour()) {
          this.openTour(0);
        }
      }, 1200);
    }

    // Apply default simple layers once when starting in simple mode
    if (this.mode === 'simple') {
      this.pushSimpleLayers();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.boundModeListener) {
      window.removeEventListener(TOPMAN_UI_MODE_EVENT, this.boundModeListener);
    }
    if (this.boundRootClick) {
      this.root.removeEventListener('click', this.boundRootClick);
    }
    this.root.replaceChildren();
  }

  getMode(): TopmanUiMode {
    return this.mode;
  }

  setMode(mode: TopmanUiMode): void {
    if (this.mode === mode) return;
    this.mode = setTopmanUiMode(mode);
    this.applyModeChrome();
    if (mode === 'simple') {
      this.pushSimpleLayers();
      void this.refreshData();
    }
    this.render();
    this.syncHeaderToggle();
  }

  private applyModeChrome(): void {
    applyTopmanUiModeToDocument(this.mode);
  }

  private pushSimpleLayers(): void {
    const base = this.callbacks.getBaseMapLayers();
    const layers = buildSimpleMapLayers(this.enabledCategories, base);
    this.callbacks.onApplySimpleLayers(layers);
  }

  private bindEvents(): void {
    this.boundModeListener = (ev: Event) => {
      const mode = (ev as CustomEvent<{ mode?: TopmanUiMode }>).detail?.mode;
      if (mode === 'simple' || mode === 'advanced') {
        this.mode = mode;
        this.applyModeChrome();
        this.render();
        this.syncHeaderToggle();
      }
    };
    window.addEventListener(TOPMAN_UI_MODE_EVENT, this.boundModeListener);

    this.boundRootClick = (ev: MouseEvent) => {
      const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (!action) return;
      ev.preventDefault();
      this.handleAction(action, target);
    };
    this.root.addEventListener('click', this.boundRootClick);

    // Header toggle (outside root) — delegated once on document
    document.getElementById('topmanModeToggle')?.addEventListener('click', () => {
      this.setMode(this.mode === 'simple' ? 'advanced' : 'simple');
    });
    document.getElementById('mobileMenuTopmanMode')?.addEventListener('click', () => {
      this.setMode(this.mode === 'simple' ? 'advanced' : 'simple');
    });
  }

  private handleAction(action: string, el: HTMLElement): void {
    switch (action) {
      case 'switch-advanced':
        this.setMode('advanced');
        break;
      case 'switch-simple':
        this.setMode('simple');
        break;
      case 'start-tour':
        resetGuidedTour();
        this.openTour(0);
        break;
      case 'tour-skip':
        dismissGuidedTour();
        this.closeTour();
        break;
      case 'tour-next': {
        const steps = getGuidedTourSteps();
        if (this.tourStep >= steps.length - 1) {
          completeGuidedTour();
          this.closeTour();
        } else {
          this.openTour(this.tourStep + 1);
        }
        break;
      }
      case 'tour-prev':
        this.openTour(Math.max(0, this.tourStep - 1));
        break;
      case 'toggle-category': {
        const id = el.dataset.categoryId as SimpleMapCategoryId | undefined;
        if (!id) return;
        this.toggleCategory(id);
        break;
      }
      case 'apply-mission': {
        const id = el.dataset.missionId as MissionPresetId | undefined;
        if (id) this.callbacks.onApplyMission(id);
        this.render();
        break;
      }
      case 'card-detail': {
        const cardId = el.dataset.cardId as SimpleSummaryCard['id'] | undefined;
        if (cardId) {
          this.callbacks.onOpenCardDetail(cardId);
          this.setMode('advanced');
        }
        break;
      }
      case 'refresh-summary':
        void this.refreshData(true);
        break;
      default:
        break;
    }
  }

  private toggleCategory(id: SimpleMapCategoryId): void {
    const set = new Set(this.enabledCategories);
    if (set.has(id)) {
      if (set.size <= 1) return; // keep at least one
      set.delete(id);
    } else {
      if (set.size >= 5) return;
      set.add(id);
    }
    this.enabledCategories = SIMPLE_MAP_CATEGORIES
      .map((c) => c.id)
      .filter((cid) => set.has(cid));
    saveSimpleMapCategories(this.enabledCategories);
    this.pushSimpleLayers();
    this.render();
  }

  private openTour(step: number): void {
    this.tourOpen = true;
    this.tourStep = step;
    this.render();
  }

  private closeTour(): void {
    this.tourOpen = false;
    this.render();
  }

  async refreshData(force = false): Promise<void> {
    if (this.destroyed) return;

    let insights: ServerInsights | null = getServerInsights();
    if (!insights || force) {
      insights = await fetchServerInsights(5000);
    }

    try {
      this.health = await fetchTopmanHealthSnapshot();
    } catch {
      this.health = classifyTopmanHealthPayload(null);
    }

    this.summary = buildSimpleExecutiveSummary({
      insights,
      health: this.health,
    });

    if (!this.destroyed) {
      this.render();
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        void this.refreshData();
      }, 5 * 60_000);
    }
  }

  private syncHeaderToggle(): void {
    const btn = document.getElementById('topmanModeToggle');
    if (btn) {
      const next = this.mode === 'simple' ? 'advanced' : 'simple';
      const labels = getTopmanUiModeLabel(next);
      btn.textContent = labels.full;
      btn.setAttribute('aria-label', labels.full);
      btn.dataset.mode = this.mode;
      btn.title = labels.full;
    }
    const mobile = document.getElementById('mobileMenuTopmanMode');
    const mobileLabel = mobile?.querySelector('.mobile-menu-item-label');
    if (mobileLabel) {
      const next = this.mode === 'simple' ? 'advanced' : 'simple';
      mobileLabel.textContent = getTopmanUiModeLabel(next).full;
    }
  }

  private render(): void {
    if (this.destroyed) return;

    // Advanced mode: keep a slim strip so users can return to simple
    if (this.mode === 'advanced') {
      setTrustedHtml(this.root, trustedHtml(`
        <div class="topman-simple-advanced-strip" role="region" aria-label="${escapeHtml(topmanText('สลับโหมด', 'Mode switch'))}">
          <div class="topman-simple-advanced-strip__copy">
            <strong>${escapeHtml(topmanText('โหมดผู้เชี่ยวชาญ', 'Advanced Mode'))}</strong>
            <span>${escapeHtml(topmanText('แดชบอร์ดเต็มรูปแบบ · เลเยอร์และแผงครบ', 'Full dashboard · all layers and panels'))}</span>
          </div>
          <div class="topman-simple-advanced-strip__actions">
            <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="start-tour">${escapeHtml(topmanText('พาชมระบบ', 'Tour'))}</button>
            <button type="button" class="topman-simple-btn topman-simple-btn--primary" data-action="switch-simple" data-tour="mode-switch">
              ${escapeHtml(topmanText('กลับโหมดใช้ง่าย', 'Back to Simple Mode'))}
            </button>
          </div>
        </div>
        ${this.tourOpen ? this.renderTourOverlay() : ''}
      `, 'Topman simple mode advanced strip'));
      this.syncHeaderToggle();
      return;
    }

    const summary = this.summary ?? buildSimpleExecutiveSummary({ insights: null, health: this.health });
    const statusLabel = formatSimpleDataStatusLabel(summary.status);
    const missions = getMissionPresetsForVariant(SITE_VARIANT);
    const activeMission = this.callbacks.getActiveMissionId?.() ?? null;
    const legend = describeSimpleMapLegend(this.enabledCategories);

    setTrustedHtml(this.root, trustedHtml(`
      <section class="topman-simple-shell" aria-label="${escapeHtml(topmanText('โหมดใช้ง่าย TOPMAN', 'TOPMAN Simple Mode'))}">
        <header class="topman-simple-exec" data-tour="summary">
          <div class="topman-simple-exec__kicker">
            <span class="topman-simple-badge topman-simple-badge--${escapeHtml(summary.status)}">${escapeHtml(statusLabel)}</span>
            <span class="topman-simple-kicker-text">${escapeHtml(topmanText('สรุปสำหรับผู้บริหาร', 'Executive summary'))}</span>
          </div>
          <h1 class="topman-simple-exec__title">${escapeHtml(summary.headline)}</h1>
          <p class="topman-simple-exec__body">${escapeHtml(summary.body)}</p>
          <div class="topman-simple-exec__meta">
            <span>${escapeHtml(topmanText('แหล่งที่ใช้อ้างอิง', 'Sources used'))}: ${escapeHtml(summary.generatedFrom.length ? summary.generatedFrom.join(', ') : topmanText('ยังไม่มี', 'None yet'))}</span>
            <div class="topman-simple-exec__actions">
              <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="refresh-summary">${escapeHtml(topmanText('รีเฟรชสรุป', 'Refresh'))}</button>
              <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="start-tour">${escapeHtml(topmanText('พาชมระบบ 60 วินาที', '60s tour'))}</button>
              <button type="button" class="topman-simple-btn topman-simple-btn--primary" data-action="switch-advanced" data-tour="mode-switch">
                ${escapeHtml(topmanText('โหมดผู้เชี่ยวชาญ', 'Advanced Mode'))}
              </button>
            </div>
          </div>
        </header>

        <div class="topman-simple-cards" data-tour="cards">
          ${summary.cards.map((card) => this.renderCard(card)).join('')}
        </div>

        <section class="topman-simple-map-panel" aria-labelledby="topman-simple-map-title">
          <div class="topman-simple-section-head">
            <div>
              <h2 id="topman-simple-map-title">${escapeHtml(topmanText('แผนที่แบบง่าย', 'Simple map'))}</h2>
              <p>${escapeHtml(topmanText('เปิดได้ไม่เกิน 5 หมวด — แตะเพื่อดูคำอธิบาย', 'At most five categories — tap for explanations'))}</p>
            </div>
          </div>
          <div class="topman-simple-categories" data-tour="map-categories" role="group" aria-label="${escapeHtml(topmanText('หมวดแผนที่', 'Map categories'))}">
            ${SIMPLE_MAP_CATEGORIES.map((cat) => {
              const on = this.enabledCategories.includes(cat.id);
              return `
                <button
                  type="button"
                  class="topman-simple-chip${on ? ' is-on' : ''}"
                  data-action="toggle-category"
                  data-category-id="${escapeHtml(cat.id)}"
                  aria-pressed="${on ? 'true' : 'false'}"
                  title="${escapeHtml(cat.description)}"
                  style="--chip-color:${escapeHtml(cat.color)}"
                >
                  <span class="topman-simple-chip__dot" aria-hidden="true"></span>
                  <span class="topman-simple-chip__label">${escapeHtml(cat.shortLabel)}</span>
                </button>
              `;
            }).join('')}
          </div>
          <ul class="topman-simple-legend" aria-label="${escapeHtml(topmanText('คำอธิบายสัญลักษณ์', 'Legend'))}">
            ${legend.map((item) => `
              <li>
                <span class="topman-simple-legend__swatch" style="background:${escapeHtml(item.color)}"></span>
                <div>
                  <strong>${escapeHtml(item.label)}</strong>
                  <span>${escapeHtml(item.description)}</span>
                </div>
              </li>
            `).join('')}
          </ul>
          <p class="topman-simple-map-hint">
            ${escapeHtml(topmanText(
              'แผนที่จริงอยู่ด้านล่าง — เลื่อนลงเพื่อสำรวจจุดบนแผนที่',
              'The live map is below — scroll to explore points on the map',
            ))}
          </p>
        </section>

        <section class="topman-simple-missions" data-tour="missions" aria-labelledby="topman-simple-missions-title">
          <div class="topman-simple-section-head">
            <div>
              <h2 id="topman-simple-missions-title">${escapeHtml(topmanText('ภารกิจสำเร็จรูป', 'Ready-made missions'))}</h2>
              <p>${escapeHtml(topmanText('เลือกภารกิจแทนการเปิดเลเยอร์เอง', 'Pick a mission instead of choosing layers yourself'))}</p>
            </div>
          </div>
          <div class="topman-simple-mission-grid">
            ${missions.map((mission) => {
              const selected = activeMission === mission.id;
              return `
                <button
                  type="button"
                  class="topman-simple-mission${selected ? ' is-selected' : ''}"
                  data-action="apply-mission"
                  data-mission-id="${escapeHtml(mission.id)}"
                  aria-pressed="${selected ? 'true' : 'false'}"
                >
                  <span class="topman-simple-mission__icon">${escapeHtml(mission.icon)}</span>
                  <span class="topman-simple-mission__body">
                    <strong>${escapeHtml(mission.label)}</strong>
                    <small>${escapeHtml(mission.description)}</small>
                  </span>
                </button>
              `;
            }).join('')}
          </div>
        </section>

        <footer class="topman-simple-trust">
          <p>
            ${escapeHtml(topmanText(
              'สถานะข้อมูลหลัก (TOPMAN Core) ไม่ใช่การยืนยันว่าระบบแหล่งข้อมูลทั้งหมดพร้อมสมบูรณ์',
              'TOPMAN Core status does not mean every external source in the full system is healthy.',
            ))}
          </p>
          <p class="topman-simple-attribution">
            ${escapeHtml(topmanText('ขับเคลื่อนด้วย', 'Powered by'))}
            <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noopener">World Monitor</a>
            · AGPL-3.0 · TOPMANIDMB
          </p>
        </footer>
      </section>
      ${this.tourOpen ? this.renderTourOverlay() : ''}
    `, 'Topman simple mode shell'));

    this.syncHeaderToggle();
  }

  private renderCard(card: SimpleSummaryCard): string {
    const sources = card.sources.length
      ? card.sources.map((s) => escapeHtml(s)).join(' · ')
      : escapeHtml(topmanText('ยังไม่มีแหล่ง', 'No sources yet'));
    return `
      <article class="topman-simple-card topman-simple-card--${escapeHtml(card.level)}" data-card-id="${escapeHtml(card.id)}">
        <div class="topman-simple-card__top">
          <h3>${escapeHtml(card.title)}</h3>
          <span class="topman-simple-level topman-simple-level--${escapeHtml(card.level)}" title="${escapeHtml(card.levelLabel)}">
            ${escapeHtml(card.levelLabel)}
          </span>
        </div>
        <p class="topman-simple-card__summary">${escapeHtml(card.summary)}</p>
        <div class="topman-simple-card__meta">
          <span>${escapeHtml(card.updatedLabel)}</span>
          <span class="topman-simple-card__sources" title="${sources}">${escapeHtml(topmanText('แหล่ง', 'Sources'))}: ${sources}</span>
        </div>
        <button
          type="button"
          class="topman-simple-btn topman-simple-btn--card"
          data-action="card-detail"
          data-card-id="${escapeHtml(card.id)}"
        >${escapeHtml(topmanText('ดูรายละเอียด', 'View details'))}</button>
      </article>
    `;
  }

  private renderTourOverlay(): string {
    const steps = getGuidedTourSteps();
    const step: GuidedTourStep = steps[this.tourStep] ?? steps[0]!;
    const isLast = this.tourStep >= steps.length - 1;
    return `
      <div class="topman-simple-tour" role="dialog" aria-modal="true" aria-labelledby="topman-tour-title">
        <div class="topman-simple-tour__panel">
          <div class="topman-simple-tour__progress">
            ${escapeHtml(topmanText(`ขั้นตอน ${this.tourStep + 1}/${steps.length}`, `Step ${this.tourStep + 1}/${steps.length}`))}
          </div>
          <h2 id="topman-tour-title">${escapeHtml(step.title)}</h2>
          <p>${escapeHtml(step.body)}</p>
          <div class="topman-simple-tour__actions">
            <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="tour-skip">
              ${escapeHtml(topmanText('ข้าม', 'Skip'))}
            </button>
            <div class="topman-simple-tour__nav">
              <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="tour-prev" ${this.tourStep === 0 ? 'disabled' : ''}>
                ${escapeHtml(topmanText('ก่อนหน้า', 'Back'))}
              </button>
              <button type="button" class="topman-simple-btn topman-simple-btn--primary" data-action="tour-next">
                ${escapeHtml(isLast ? topmanText('เสร็จสิ้น', 'Done') : topmanText('ถัดไป', 'Next'))}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
