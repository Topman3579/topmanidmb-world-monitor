type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export type InstallSurface = 'installed' | 'ios' | 'prompt' | 'unavailable';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

const SESSION_DISMISSED_KEY = 'topman-pwa-install-dismissed';

export function isIosLike(
  userAgent: string,
  platform = '',
  maxTouchPoints = 0,
): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function isStandaloneDisplay(
  matchesStandalone: boolean,
  navigatorStandalone = false,
): boolean {
  return matchesStandalone || navigatorStandalone;
}

export function classifyInstallSurface(options: {
  installed: boolean;
  iosLike: boolean;
  hasPrompt: boolean;
  isDesktopShell?: boolean;
}): InstallSurface {
  if (options.isDesktopShell || options.installed) return 'installed';
  if (options.iosLike) return 'ios';
  if (options.hasPrompt) return 'prompt';
  return 'unavailable';
}

function makeElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function getStandaloneState(): boolean {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  return isStandaloneDisplay(
    window.matchMedia('(display-mode: standalone)').matches,
    navigatorWithStandalone.standalone === true,
  );
}

function isDesktopShell(): boolean {
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

function wasDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSessionDismissal(): void {
  try {
    sessionStorage.setItem(SESSION_DISMISSED_KEY, '1');
  } catch {
    // Storage can be unavailable in hardened or embedded browser contexts.
  }
}

export function initPwaInstallExperience(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || isDesktopShell()) return;

  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let installed = getStandaloneState();
  const iosLike = isIosLike(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

  const mount = (): void => {
    if (document.getElementById('topmanPwaInstall')) return;

    const root = makeElement('aside', 'topman-pwa-install');
    root.id = 'topmanPwaInstall';
    root.hidden = true;
    root.setAttribute('aria-label', 'Install TOPMANIDMB World Monitor');

    const icon = makeElement('img', 'topman-pwa-install__icon');
    icon.src = '/favico/android-chrome-192x192.png';
    icon.alt = '';
    icon.width = 36;
    icon.height = 36;

    const copy = makeElement('span', 'topman-pwa-install__copy');
    const title = makeElement('strong', '', 'ติดตั้ง TOPMAN World');
    const subtitle = makeElement('span', '', 'เปิดเต็มจอ ใช้งานได้เหมือนแอป');
    copy.append(title, subtitle);

    const installButton = makeElement('button', 'topman-pwa-install__action', 'ติดตั้ง');
    installButton.type = 'button';

    const closeButton = makeElement('button', 'topman-pwa-install__close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'ปิดคำแนะนำการติดตั้ง');

    root.append(icon, copy, installButton, closeButton);

    const backdrop = makeElement('div', 'topman-pwa-guide-backdrop');
    backdrop.id = 'topmanPwaGuideBackdrop';
    backdrop.hidden = true;

    const dialog = makeElement('section', 'topman-pwa-guide');
    dialog.id = 'topmanPwaGuide';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'topmanPwaGuideTitle');

    const guideHeader = makeElement('div', 'topman-pwa-guide__header');
    const guideHeading = makeElement('div');
    const eyebrow = makeElement('span', 'topman-pwa-guide__eyebrow', 'TOPMANIDMB · MOBILE APP');
    const heading = makeElement('h2', '', 'ติดตั้งบน iPhone หรือ iPad');
    heading.id = 'topmanPwaGuideTitle';
    guideHeading.append(eyebrow, heading);
    const guideClose = makeElement('button', 'topman-pwa-guide__close', '×');
    guideClose.type = 'button';
    guideClose.setAttribute('aria-label', 'ปิด');
    guideHeader.append(guideHeading, guideClose);

    const guideIntro = makeElement(
      'p',
      'topman-pwa-guide__intro',
      'ใช้ Safari เปิดหน้านี้ แล้วทำ 3 ขั้นตอนเพื่อเพิ่ม TOPMAN World ไว้บนหน้าจอโฮม',
    );
    const steps = makeElement('ol', 'topman-pwa-guide__steps');
    for (const [step, detail] of [
      ['แตะปุ่ม Share', 'ไอคอนสี่เหลี่ยมมีลูกศรชี้ขึ้น'],
      ['เลือก Add to Home Screen', 'หรือ “เพิ่มไปยังหน้าจอโฮม”'],
      ['แตะ Add', 'จากนั้นเปิดใช้งานแบบเต็มจอได้ทันที'],
    ]) {
      const item = makeElement('li');
      const stepTitle = makeElement('strong', '', step);
      const stepDetail = makeElement('span', '', detail);
      item.append(stepTitle, stepDetail);
      steps.append(item);
    }
    const guideNote = makeElement(
      'p',
      'topman-pwa-guide__note',
      'ช่องทาง native iOS ผ่าน TestFlight ยังใช้งานแยกจากเว็บแอปนี้ได้ตามเดิม',
    );
    const guideDone = makeElement('button', 'topman-pwa-guide__done', 'เข้าใจแล้ว');
    guideDone.type = 'button';

    dialog.append(guideHeader, guideIntro, steps, guideNote, guideDone);
    document.body.append(root, backdrop, dialog);

    const closeGuide = (): void => {
      backdrop.hidden = true;
      dialog.hidden = true;
      document.body.classList.remove('topman-pwa-guide-open');
      installButton.focus();
    };

    const openGuide = (): void => {
      backdrop.hidden = false;
      dialog.hidden = false;
      document.body.classList.add('topman-pwa-guide-open');
      guideClose.focus();
    };

    const updateVisibility = (): void => {
      installed = installed || getStandaloneState();
      const surface = classifyInstallSurface({
        installed,
        iosLike,
        hasPrompt: deferredPrompt !== null,
        isDesktopShell: isDesktopShell(),
      });
      root.hidden = surface === 'installed' || surface === 'unavailable' || wasDismissedThisSession();
      installButton.textContent = surface === 'ios' ? 'ดูวิธีติดตั้ง' : 'ติดตั้ง';
    };

    installButton.addEventListener('click', async () => {
      if (iosLike) {
        openGuide();
        return;
      }
      if (!deferredPrompt) return;
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') installed = true;
      updateVisibility();
    });

    closeButton.addEventListener('click', () => {
      rememberSessionDismissal();
      updateVisibility();
    });
    guideClose.addEventListener('click', closeGuide);
    guideDone.addEventListener('click', closeGuide);
    backdrop.addEventListener('click', closeGuide);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !dialog.hidden) closeGuide();
    });

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
      updateVisibility();
    });
    window.addEventListener('appinstalled', () => {
      installed = true;
      deferredPrompt = null;
      closeGuide();
      updateVisibility();
    });

    window.matchMedia('(display-mode: standalone)').addEventListener('change', updateVisibility);
    updateVisibility();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
