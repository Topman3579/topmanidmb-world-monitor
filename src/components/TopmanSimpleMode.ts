import { getMissionPresetsForVariant, type MissionPresetId } from '@/services/mission-presets';
import { SITE_VARIANT } from '@/config/variant';
import {
  fetchServerInsights,
  getServerInsights,
  type ServerInsights,
} from '@/services/insights-loader';
import {
  classifyTopmanHealthPayload,
  fetchCompactSystemHealthBrief,
  fetchTopmanHealthSnapshot,
  type SystemHealthBrief,
  type TopmanHealthSnapshot,
} from '@/services/topman-health-status';
import {
  getTopmanBrandSubtitle,
  getTopmanBriefAudienceLabel,
  getTopmanProductMission,
  getTopmanProductName,
  getTopmanWorkflowTag,
  topmanText,
} from '@/services/topman-language-mode';
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
  getSimpleMapCategories,
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
import {
  approveTopmanDailyBrief,
  buildTopmanDailyBriefFromSummary,
  fetchServerDailyBrief,
  formatBriefStatusLabel,
  formatThaiOfficialDate,
  getBriefAdminSecret,
  loadLocalDailyBrief,
  markTopmanDailyBriefSent,
  patchTopmanDailyBrief,
  postDailyBriefAction,
  saveLocalDailyBrief,
  setBriefAdminSecret,
  type TopmanDailyBrief,
} from '@/services/topman-daily-brief';
import { escapeHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import type { MapLayers } from '@/types';

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
  onApplyMission: (id: MissionPresetId) => void;
  onApplySimpleLayers: (layers: MapLayers) => void;
  getBaseMapLayers: () => MapLayers;
  onOpenCardDetail: (cardId: SimpleSummaryCard['id']) => void;
  getActiveMissionId?: () => string | null;
  /** Optional: scroll / focus live map after category or detail actions */
  onFocusMap?: () => void;
  /** Optional: focus a named panel in advanced mode */
  onFocusPanel?: (panelId: string) => void;
  /** Install four Pro command desks as dashboard tabs */
  onInstallProDesks?: () => void;
}

export class TopmanSimpleMode {
  private root: HTMLElement;
  private belowRoot: HTMLElement | null;
  private callbacks: TopmanSimpleModeCallbacks;
  private mode: TopmanUiMode;
  private summary: SimpleExecutiveSummary | null = null;
  private health: TopmanHealthSnapshot | null = null;
  private systemHealth: SystemHealthBrief | null = null;
  private dailyBrief: TopmanDailyBrief | null = null;
  private lineConfigured = false;
  private briefNotice = '';
  private lastInsights: ServerInsights | null = null;
  private enabledCategories: SimpleMapCategoryId[];
  private tourOpen = false;
  private tourStep = 0;
  private destroyed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private boundModeListener: ((ev: Event) => void) | null = null;
  private boundRootClick: ((ev: MouseEvent) => void) | null = null;
  private boundBelowClick: ((ev: MouseEvent) => void) | null = null;
  private spotlightEl: HTMLElement | null = null;

  constructor(root: HTMLElement, callbacks: TopmanSimpleModeCallbacks, belowRoot?: HTMLElement | null) {
    this.root = root;
    this.belowRoot = belowRoot ?? document.getElementById('topmanSimpleModeBelow');
    this.callbacks = callbacks;
    this.mode = resolveTopmanUiMode();
    this.enabledCategories = loadStoredSimpleMapCategories() ?? getDefaultSimpleMapCategoryIds();
  }

  init(): void {
    this.root.classList.add('topman-simple-mode', 'topman-simple-mode--top');
    this.root.setAttribute('data-topman-simple-root', '1');
    this.root.hidden = false;
    if (this.belowRoot) {
      this.belowRoot.classList.add('topman-simple-mode', 'topman-simple-mode--below');
      this.belowRoot.setAttribute('data-topman-simple-below', '1');
      this.belowRoot.hidden = false;
    }

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
    if (this.boundBelowClick && this.belowRoot) {
      this.belowRoot.removeEventListener('click', this.boundBelowClick);
    }
    this.clearTourSpotlight();
    this.root.replaceChildren();
    this.belowRoot?.replaceChildren();
    if (this.belowRoot) this.belowRoot.hidden = true;
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
    } else {
      this.clearTourSpotlight();
      this.tourOpen = false;
    }
    this.render();
    this.syncHeaderToggle();
  }

  private applyModeChrome(): void {
    applyTopmanUiModeToDocument(this.mode);
    if (this.belowRoot) {
      this.belowRoot.hidden = this.mode !== 'simple';
    }
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

    this.boundRootClick = (ev: MouseEvent) => this.onDelegatedClick(ev);
    this.root.addEventListener('click', this.boundRootClick);
    if (this.belowRoot) {
      this.boundBelowClick = (ev: MouseEvent) => this.onDelegatedClick(ev);
      this.belowRoot.addEventListener('click', this.boundBelowClick);
    }

    document.getElementById('topmanModeToggle')?.addEventListener('click', () => {
      this.setMode(this.mode === 'simple' ? 'advanced' : 'simple');
    });
    document.getElementById('mobileMenuTopmanMode')?.addEventListener('click', () => {
      this.setMode(this.mode === 'simple' ? 'advanced' : 'simple');
    });
  }

  private onDelegatedClick(ev: MouseEvent): void {
    const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;
    ev.preventDefault();
    this.handleAction(action, target);
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
        if (this.mode !== 'simple') this.setMode('simple');
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
        if (id) {
          this.callbacks.onApplyMission(id);
          // Mission applies advanced layer/panel sets — show the full desk.
          this.setMode('advanced');
          this.callbacks.onFocusMap?.();
        }
        break;
      }
      case 'card-detail': {
        const cardId = el.dataset.cardId as SimpleSummaryCard['id'] | undefined;
        if (cardId) {
          this.callbacks.onOpenCardDetail(cardId);
          this.setMode('advanced');
          // Defer focus until advanced chrome paints
          window.setTimeout(() => {
            if (cardId === 'world') this.callbacks.onFocusPanel?.('insights');
            else if (cardId === 'asean') this.callbacks.onFocusPanel?.('live-news');
            else this.callbacks.onFocusPanel?.('live-news');
            this.callbacks.onFocusMap?.();
          }, 80);
        }
        break;
      }
      case 'scroll-to-map':
        this.callbacks.onFocusMap?.();
        document.getElementById('mapSection')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      case 'refresh-summary':
        void this.refreshData(true);
        break;
      case 'install-pro-desks':
        this.callbacks.onInstallProDesks?.();
        this.setMode('advanced');
        break;
      case 'open-pro-playbook':
        window.open('/topman-pro-business-playbook.html', '_blank', 'noopener,noreferrer');
        break;
      case 'brief-generate-local':
        void this.generateLocalBrief();
        break;
      case 'brief-copy-line':
        void this.copyBriefLineMessage();
        break;
      case 'brief-save':
        void this.persistBrief('save');
        break;
      case 'brief-approve':
        void this.persistBrief('approve');
        break;
      case 'brief-send':
        void this.persistBrief('send');
        break;
      case 'brief-set-secret': {
        const entered = window.prompt(
          topmanText(
            'ใส่รหัสผู้ตรวจบรีฟ (TOPMAN_BRIEF_ADMIN_SECRET) สำหรับบันทึก/อนุมัติ/ส่ง',
            'Enter brief admin secret for save/approve/send',
          ),
          getBriefAdminSecret(),
        );
        if (entered !== null) {
          setBriefAdminSecret(entered.trim());
          this.briefNotice = entered.trim()
            ? topmanText('บันทึกรหัสผู้ตรวจในเซสชันนี้แล้ว', 'Admin secret stored for this session')
            : topmanText('ล้างรหัสผู้ตรวจแล้ว', 'Admin secret cleared');
          this.render();
        }
        break;
      }
      default:
        break;
    }
  }

  private readBriefEditors(): { lineMessage: string; memoMarkdown: string } {
    const line = this.root.querySelector<HTMLTextAreaElement>('#topman-daily-brief-line');
    const memo = this.root.querySelector<HTMLTextAreaElement>('#topman-daily-brief-memo');
    return {
      lineMessage: line?.value ?? this.dailyBrief?.lineMessage ?? '',
      memoMarkdown: memo?.value ?? this.dailyBrief?.memoMarkdown ?? '',
    };
  }

  private async generateLocalBrief(): Promise<void> {
    const existing = this.dailyBrief;
    this.dailyBrief = buildTopmanDailyBriefFromSummary({
      summary: this.summary,
      insights: this.lastInsights,
      existing: existing?.status === 'draft' ? existing : null,
    });
    if (existing && (existing.status === 'approved' || existing.status === 'sent')) {
      this.briefNotice = topmanText(
        'บรีฟวันนี้ถูกอนุมัติหรือส่งแล้ว — ไม่เขียนทับ ใช้ปุ่มคัดลอกได้',
        'Today’s brief is already approved/sent — not overwritten',
      );
      this.render();
      return;
    }
    saveLocalDailyBrief(this.dailyBrief);
    this.briefNotice = topmanText('สร้างร่างจากสรุปหน้านี้แล้ว — ตรวจก่อนส่ง', 'Draft built from this page — review before send');
    this.render();
  }

  private async copyBriefLineMessage(): Promise<void> {
    const { lineMessage } = this.readBriefEditors();
    if (!lineMessage.trim()) {
      this.briefNotice = topmanText('ยังไม่มีข้อความ LINE', 'No LINE text yet');
      this.render();
      return;
    }
    try {
      await navigator.clipboard.writeText(lineMessage);
      this.briefNotice = topmanText('คัดลอกข้อความ LINE แล้ว — วางใน LINE OA ได้ทันที', 'LINE text copied');
    } catch {
      this.briefNotice = topmanText('คัดลอกไม่สำเร็จ — เลือกข้อความแล้วคัดลอกเอง', 'Copy failed — select text manually');
    }
    this.render();
  }

  private async persistBrief(action: 'save' | 'approve' | 'send'): Promise<void> {
    const editors = this.readBriefEditors();
    if (!this.dailyBrief) {
      this.dailyBrief = buildTopmanDailyBriefFromSummary({
        summary: this.summary,
        insights: this.lastInsights,
      });
    }
    this.dailyBrief = patchTopmanDailyBrief(this.dailyBrief, editors);

    if (action === 'approve') {
      this.dailyBrief = approveTopmanDailyBrief(this.dailyBrief);
    }

    saveLocalDailyBrief(this.dailyBrief);

    if (!getBriefAdminSecret()) {
      if (action === 'send') {
        this.briefNotice = topmanText(
          'ยังไม่มีรหัสผู้ตรวจ — คัดลอกข้อความ LINE ไปส่งเอง หรือตั้งรหัสก่อน',
          'No admin secret — copy LINE text or set secret first',
        );
      } else {
        this.briefNotice = topmanText(
          'บันทึกในเครื่องแล้ว (ยังไม่ได้ซิงก์เซิร์ฟเวอร์ — ตั้งรหัสผู้ตรวจเพื่อซิงก์)',
          'Saved locally (set admin secret to sync server)',
        );
      }
      this.render();
      return;
    }

    const result = await postDailyBriefAction(action, {
      dateKey: this.dailyBrief.dateKey,
      lineMessage: this.dailyBrief.lineMessage,
      memoMarkdown: this.dailyBrief.memoMarkdown,
      brief: this.dailyBrief,
    });
    this.lineConfigured = result.lineConfigured;
    if (result.brief) {
      this.dailyBrief = result.brief;
      saveLocalDailyBrief(result.brief);
    } else if (action === 'send' && result.ok) {
      this.dailyBrief = markTopmanDailyBriefSent(this.dailyBrief);
      saveLocalDailyBrief(this.dailyBrief);
    }

    if (!result.ok) {
      this.briefNotice = result.error === 'UNAUTHORIZED'
        ? topmanText('รหัสผู้ตรวจไม่ถูกต้อง หรือยังไม่ได้ตั้งบนเซิร์ฟเวอร์', 'Admin secret rejected')
        : result.error === 'LINE_NOT_CONFIGURED'
          ? topmanText('ยังไม่ได้เชื่อม LINE OA — คัดลอกข้อความไปส่งเองได้', 'LINE OA not linked — copy text instead')
          : result.error === 'NOT_APPROVED'
            ? topmanText('ต้องกดอนุมัติก่อนส่ง LINE', 'Approve before sending LINE')
            : (result.error || topmanText('บันทึกไม่สำเร็จ', 'Save failed'));
      this.render();
      return;
    }

    this.briefNotice = action === 'send'
      ? topmanText('ส่ง LINE OA แล้ว', 'Sent to LINE OA')
      : action === 'approve'
        ? topmanText('อนุมัติแล้ว — พร้อมกดส่ง LINE ก่อน 08:00', 'Approved — ready to send before 08:00')
        : topmanText('บันทึกร่างบนเซิร์ฟเวอร์แล้ว', 'Draft saved on server');
    this.render();
  }

  private async loadDailyBrief(): Promise<void> {
    const local = loadLocalDailyBrief();
    try {
      const remote = await fetchServerDailyBrief();
      this.lineConfigured = remote.lineConfigured;
      if (remote.brief) {
        if (
          !local
          || (remote.brief.updatedAt || '') >= (local.updatedAt || '')
          || remote.brief.status === 'approved'
          || remote.brief.status === 'sent'
        ) {
          this.dailyBrief = remote.brief;
          saveLocalDailyBrief(remote.brief);
          return;
        }
      }
    } catch {
      // offline / API down — keep local
    }
    if (local) this.dailyBrief = local;
  }

  private toggleCategory(id: SimpleMapCategoryId): void {
    const set = new Set(this.enabledCategories);
    if (set.has(id)) {
      if (set.size <= 1) return;
      set.delete(id);
    } else {
      if (set.size >= 5) return;
      set.add(id);
    }
    this.enabledCategories = getSimpleMapCategories()
      .map((c) => c.id)
      .filter((cid) => set.has(cid));
    saveSimpleMapCategories(this.enabledCategories);
    this.pushSimpleLayers();
    this.render();
    this.callbacks.onFocusMap?.();
  }

  private openTour(step: number): void {
    this.tourOpen = true;
    this.tourStep = step;
    this.render();
    this.applyTourSpotlight();
  }

  private closeTour(): void {
    this.tourOpen = false;
    this.clearTourSpotlight();
    this.render();
  }

  private clearTourSpotlight(): void {
    document.querySelectorAll('.topman-tour-spotlight-target').forEach((el) => {
      el.classList.remove('topman-tour-spotlight-target');
    });
    this.spotlightEl?.remove();
    this.spotlightEl = null;
  }

  private applyTourSpotlight(): void {
    this.clearTourSpotlight();
    if (!this.tourOpen) return;
    const steps = getGuidedTourSteps();
    const step = steps[this.tourStep];
    if (!step?.targetSelector) return;

    const target = document.querySelector<HTMLElement>(step.targetSelector);
    if (!target) return;

    target.classList.add('topman-tour-spotlight-target');
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    const rect = target.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = 'topman-tour-spotlight-ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.top = `${Math.max(8, rect.top - 6 + window.scrollY)}px`;
    ring.style.left = `${Math.max(8, rect.left - 6 + window.scrollX)}px`;
    ring.style.width = `${rect.width + 12}px`;
    ring.style.height = `${rect.height + 12}px`;
    document.body.appendChild(ring);
    this.spotlightEl = ring;
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

    try {
      this.systemHealth = await fetchCompactSystemHealthBrief();
    } catch {
      this.systemHealth = null;
    }

    this.lastInsights = insights;
    this.summary = buildSimpleExecutiveSummary({
      insights,
      health: this.health,
      systemHealth: this.systemHealth,
    });

    await this.loadDailyBrief();
    if (!this.dailyBrief) {
      this.dailyBrief = buildTopmanDailyBriefFromSummary({
        summary: this.summary,
        insights,
      });
      saveLocalDailyBrief(this.dailyBrief);
    }

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

    if (this.mode === 'advanced') {
      if (this.belowRoot) {
        this.belowRoot.hidden = true;
        this.belowRoot.replaceChildren();
      }
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
      if (this.tourOpen) {
        window.requestAnimationFrame(() => this.applyTourSpotlight());
      }
      return;
    }

    if (this.belowRoot) this.belowRoot.hidden = false;

    const summary = this.summary ?? buildSimpleExecutiveSummary({
      insights: null,
      health: this.health,
      systemHealth: this.systemHealth,
    });
    const statusLabel = formatSimpleDataStatusLabel(summary.status);
    const sourceLabels = summary.generatedFromLabels.length
      ? summary.generatedFromLabels.join(' · ')
      : topmanText('ยังไม่มี', 'None yet');
    const missions = getMissionPresetsForVariant(SITE_VARIANT);
    const activeMission = this.callbacks.getActiveMissionId?.() ?? null;
    const categories = getSimpleMapCategories();
    const legend = describeSimpleMapLegend(this.enabledCategories);

    // TOP: executive summary + cards + map category chips (above live map)
    const productName = getTopmanProductName();
    const productSubtitle = getTopmanBrandSubtitle();
    const productMission = getTopmanProductMission();
    const workflowTag = getTopmanWorkflowTag();

    setTrustedHtml(this.root, trustedHtml(`
      <section class="topman-simple-shell topman-simple-shell--top" aria-label="${escapeHtml(productName)}">
        <header class="topman-simple-exec" data-tour="summary">
          <div class="topman-simple-product">
            <div class="topman-simple-product__name">${escapeHtml(productName)}</div>
            <div class="topman-simple-product__subtitle">${escapeHtml(productSubtitle)}</div>
            <p class="topman-simple-product__mission">${escapeHtml(productMission)}</p>
            <div class="topman-simple-product__workflow">${escapeHtml(workflowTag)}</div>
          </div>
          <div class="topman-simple-exec__kicker">
            <span class="topman-simple-badge topman-simple-badge--${escapeHtml(summary.status)}">${escapeHtml(statusLabel)}</span>
            <span class="topman-simple-kicker-text">${escapeHtml(topmanText('สรุปสำหรับ ผบ.ตร. / นายกฯ · เข้าใจข่าวสารและตัดสินใจ', 'Brief for Commissioner / PM · awareness and decisions'))}</span>
          </div>
          <div class="topman-simple-health-strip" data-tour="health-strip" role="status" aria-live="polite">
            <span class="topman-simple-health-strip__core">${escapeHtml(summary.coreStrip)}</span>
            <span class="topman-simple-health-strip__sep" aria-hidden="true">·</span>
            <span class="topman-simple-health-strip__system">${escapeHtml(summary.systemStrip)}</span>
            <span class="topman-simple-health-strip__note">${escapeHtml(summary.healthScopeNote)}</span>
          </div>
          <h1 class="topman-simple-exec__title">${escapeHtml(summary.headline)}</h1>
          <p class="topman-simple-exec__body">${escapeHtml(summary.body)}</p>
          <div class="topman-simple-exec__meta">
            <span>${escapeHtml(topmanText('แหล่งที่ใช้อ้างอิง', 'Sources used'))}: ${escapeHtml(sourceLabels)}</span>
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

        ${this.renderDailyBriefPanel()}

        <section class="topman-simple-map-panel" aria-labelledby="topman-simple-map-title">
          <div class="topman-simple-section-head">
            <div>
              <h2 id="topman-simple-map-title">${escapeHtml(topmanText('แผนที่แบบง่าย', 'Simple map'))}</h2>
              <p>${escapeHtml(topmanText('เปิดได้ไม่เกิน 5 หมวด — แตะเพื่อดูคำอธิบาย แผนที่สดอยู่ถัดลงไป', 'At most five categories — live map is directly below'))}</p>
            </div>
            <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="scroll-to-map">
              ${escapeHtml(topmanText('ไปที่แผนที่', 'Go to map'))}
            </button>
          </div>
          <div class="topman-simple-categories" data-tour="map-categories" role="group" aria-label="${escapeHtml(topmanText('หมวดแผนที่', 'Map categories'))}">
            ${categories.map((cat) => {
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
        </section>
      </section>
      ${this.tourOpen ? this.renderTourOverlay() : ''}
    `, 'Topman simple mode top shell'));

    // BELOW map: missions + trust
    if (this.belowRoot) {
      setTrustedHtml(this.belowRoot, trustedHtml(`
        <section class="topman-simple-shell topman-simple-shell--below">
          <section class="topman-simple-missions" data-tour="missions" aria-labelledby="topman-simple-missions-title">
            <div class="topman-simple-section-head">
              <div>
                <h2 id="topman-simple-missions-title">${escapeHtml(topmanText('ภารกิจสำเร็จรูป', 'Ready-made missions'))}</h2>
                <p>${escapeHtml(topmanText('เลือกภารกิจแทนการเปิดเลเยอร์เอง — จะเปิดโหมดผู้เชี่ยวชาญให้อัตโนมัติ', 'Pick a mission instead of layers — opens Advanced Mode automatically'))}</p>
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
                'สถานะข้อมูลหลัก (TOPMAN Core 6 ชุด) ไม่ใช่การยืนยันว่าระบบแหล่งข้อมูลทั้งหมดพร้อมสมบูรณ์ — ดูแถบ “ข้อมูลหลัก / ระบบเต็ม” ด้านบนสรุป',
                'TOPMAN Core (6 lanes) does not mean every external source is healthy — see the Core / Full-system strip above the brief.',
              ))}
            </p>
            <div class="topman-simple-pro-actions">
              <button type="button" class="topman-simple-btn topman-simple-btn--primary" data-action="install-pro-desks">
                ${escapeHtml(topmanText('ติดตั้งโต๊ะ Pro 4 ใบ', 'Install 4 Pro desks'))}
              </button>
              <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="open-pro-playbook">
                ${escapeHtml(topmanText('คู่มือ Pro Business', 'Pro Business playbook'))}
              </button>
            </div>
            <p class="topman-simple-attribution">
              ${escapeHtml(topmanText('ขับเคลื่อนด้วย', 'Powered by'))}
              <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noopener">World Monitor</a>
              · AGPL-3.0 · TOPMANIDMB
            </p>
          </footer>
        </section>
      `, 'Topman simple mode below-map shell'));
    }

    this.syncHeaderToggle();
    if (this.tourOpen) {
      window.requestAnimationFrame(() => this.applyTourSpotlight());
    }
  }

  private renderDailyBriefPanel(): string {
    const brief = this.dailyBrief;
    if (!brief) {
      return `
        <section class="topman-simple-daily-brief" aria-labelledby="topman-daily-brief-title">
          <div class="topman-simple-section-head">
            <div>
              <h2 id="topman-daily-brief-title">${escapeHtml(topmanText('บทสรุปบริหารรายวัน', 'Daily executive brief'))}</h2>
              <p>${escapeHtml(topmanText('กำลังเตรียมร่าง…', 'Preparing draft…'))}</p>
            </div>
            <button type="button" class="topman-simple-btn topman-simple-btn--primary" data-action="brief-generate-local">
              ${escapeHtml(topmanText('สร้างร่างตอนนี้', 'Build draft now'))}
            </button>
          </div>
        </section>
      `;
    }

    const statusLabel = formatBriefStatusLabel(brief.status);
    const dateLabel = formatThaiOfficialDate(brief.dateKey);
    const lineNote = this.lineConfigured
      ? topmanText('เชื่อม LINE OA แล้ว — กดอนุมัติแล้วจึงส่ง', 'LINE OA linked — approve then send')
      : topmanText('ยังไม่ได้เชื่อม LINE OA — คัดลอกข้อความไปส่งเองได้', 'LINE OA not linked — copy text to send manually');
    const hasSecret = Boolean(getBriefAdminSecret());

    return `
      <section class="topman-simple-daily-brief" data-tour="daily-brief" aria-labelledby="topman-daily-brief-title">
        <div class="topman-simple-section-head">
          <div>
            <h2 id="topman-daily-brief-title">${escapeHtml(topmanText('บทสรุปบริหารรายวัน', 'Daily executive brief'))}</h2>
            <p>
              ${escapeHtml(topmanText('นำเสนอ ผบ.ตร. / นายกรัฐมนตรี · ตรวจก่อนส่ง LINE ก่อน 08:00', 'For Commissioner / PM · review before LINE send by 08:00'))}
              · ${escapeHtml(getTopmanBriefAudienceLabel())}
              · ${escapeHtml(dateLabel)}
            </p>
          </div>
          <span class="topman-simple-badge topman-simple-badge--${escapeHtml(brief.status === 'sent' ? 'ready' : brief.status === 'approved' ? 'partial' : 'stale')}">
            ${escapeHtml(statusLabel)}
          </span>
        </div>
        <p class="topman-simple-daily-brief__meta">
          ${escapeHtml(lineNote)}
          · ${escapeHtml(hasSecret
            ? topmanText('มีรหัสผู้ตรวจในเซสชันนี้', 'Admin secret set for this session')
            : topmanText('ยังไม่มีรหัสผู้ตรวจ (บันทึกในเครื่องได้)', 'No admin secret (local save ok)'))}
        </p>
        ${this.briefNotice ? `<p class="topman-simple-daily-brief__notice" role="status">${escapeHtml(this.briefNotice)}</p>` : ''}
        <label class="topman-simple-daily-brief__label" for="topman-daily-brief-line">
          ${escapeHtml(topmanText('ข้อความ LINE (สั้น)', 'LINE message (short)'))}
        </label>
        <textarea id="topman-daily-brief-line" class="topman-simple-daily-brief__textarea" rows="10" spellcheck="false">${escapeHtml(brief.lineMessage)}</textarea>
        <label class="topman-simple-daily-brief__label" for="topman-daily-brief-memo">
          ${escapeHtml(topmanText('บันทึกสรุปผู้บริหาร', 'Executive memo'))}
        </label>
        <textarea id="topman-daily-brief-memo" class="topman-simple-daily-brief__textarea topman-simple-daily-brief__textarea--memo" rows="12" spellcheck="false">${escapeHtml(brief.memoMarkdown)}</textarea>
        <div class="topman-simple-daily-brief__actions">
          <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="brief-generate-local">
            ${escapeHtml(topmanText('สร้างร่างจากสรุปหน้านี้', 'Rebuild from this page'))}
          </button>
          <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="brief-copy-line">
            ${escapeHtml(topmanText('คัดลอกข้อความ LINE', 'Copy LINE text'))}
          </button>
          <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="brief-set-secret">
            ${escapeHtml(topmanText('ตั้งรหัสผู้ตรวจ', 'Set reviewer secret'))}
          </button>
          <button type="button" class="topman-simple-btn topman-simple-btn--ghost" data-action="brief-save">
            ${escapeHtml(topmanText('บันทึกร่าง', 'Save draft'))}
          </button>
          <button type="button" class="topman-simple-btn topman-simple-btn--primary" data-action="brief-approve">
            ${escapeHtml(topmanText('อนุมัติ', 'Approve'))}
          </button>
          <button type="button" class="topman-simple-btn topman-simple-btn--primary" data-action="brief-send" ${brief.status === 'draft' ? 'disabled' : ''}>
            ${escapeHtml(topmanText('ส่ง LINE OA', 'Send LINE OA'))}
          </button>
        </div>
      </section>
    `;
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
