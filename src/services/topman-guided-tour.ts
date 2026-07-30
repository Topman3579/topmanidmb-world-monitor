import { topmanText } from '@/services/topman-language-mode';

export const TOPMAN_TOUR_DISMISSED_KEY = 'topman-guided-tour-dismissed-v1';
export const TOPMAN_TOUR_COMPLETED_KEY = 'topman-guided-tour-completed-v1';

export interface GuidedTourStep {
  id: string;
  title: string;
  body: string;
  targetSelector: string | null;
}

export function getGuidedTourSteps(): GuidedTourStep[] {
  return [
    {
      id: 'summary',
      title: topmanText('ดูสรุปตรงไหน', 'Where to read the summary'),
      body: topmanText(
        'ด้านบนสุดคือบทสรุปสำหรับผู้บริหาร — อ่าน 10 วินาทีแล้วรู้ว่าวันนี้เกิดอะไรขึ้น',
        'The executive summary at the top answers “what happened today” in about 10 seconds.',
      ),
      targetSelector: '[data-tour="summary"]',
    },
    {
      id: 'levels',
      title: topmanText('สีแต่ละสีหมายถึงอะไร', 'What the colors mean'),
      body: topmanText(
        'เขียว/ฟ้า = สงบหรือเฝ้าระวัง · ทอง = สูงขึ้น · แดง = วิกฤต · เทา = ยังตรวจยืนยันไม่ได้ แตะการ์ดเพื่ออ่านคำอธิบาย',
        'Calm/watch use cool tones · gold is elevated · red is critical · grey means unverified. Tap a card for the plain-language label.',
      ),
      targetSelector: '[data-tour="cards"]',
    },
    {
      id: 'missions',
      title: topmanText('วิธีเลือกภารกิจ', 'How to pick a mission'),
      body: topmanText(
        'เลือก “ภารกิจ” แทนการเปิดเลเยอร์เอง — ระบบจะจัดแผนที่และแผงที่เกี่ยวข้องให้',
        'Choose a mission instead of toggling layers. The map and related views adjust for you.',
      ),
      targetSelector: '[data-tour="missions"]',
    },
    {
      id: 'map',
      title: topmanText('วิธีดูเหตุการณ์บนแผนที่', 'How to read the map'),
      body: topmanText(
        'เปิดได้ไม่เกิน 5 หมวดหลัก แตะหมวดเพื่อเปิด/ปิด แล้วดูแผนที่สดถัดลงไป — กด “ไปที่แผนที่” ได้ถ้าต้องการ',
        'At most five categories. Toggle chips, then read the live map just below — or tap “Go to map”.',
      ),
      targetSelector: '[data-tour="map-categories"]',
    },
    {
      id: 'advanced',
      title: topmanText('วิธีเข้าสู่โหมดผู้เชี่ยวชาญ', 'How to open Advanced Mode'),
      body: topmanText(
        'กด “โหมดผู้เชี่ยวชาญ” เมื่อต้องการเลเยอร์ แผง และเครื่องมือเต็มรูปแบบ — โหมดใช้ง่ายยังกลับมาได้ทุกเมื่อ',
        'Use “Advanced Mode” for the full dashboard. You can return to Simple Mode anytime.',
      ),
      targetSelector: '[data-tour="mode-switch"]',
    },
  ];
}

export function isGuidedTourDismissed(): boolean {
  try {
    return localStorage.getItem(TOPMAN_TOUR_DISMISSED_KEY) === '1'
      || localStorage.getItem(TOPMAN_TOUR_COMPLETED_KEY) === '1';
  } catch {
    return true;
  }
}

export function dismissGuidedTour(): void {
  try {
    localStorage.setItem(TOPMAN_TOUR_DISMISSED_KEY, '1');
  } catch {
    // ignore
  }
}

export function completeGuidedTour(): void {
  try {
    localStorage.setItem(TOPMAN_TOUR_COMPLETED_KEY, '1');
    localStorage.setItem(TOPMAN_TOUR_DISMISSED_KEY, '1');
  } catch {
    // ignore
  }
}

export function resetGuidedTour(): void {
  try {
    localStorage.removeItem(TOPMAN_TOUR_DISMISSED_KEY);
    localStorage.removeItem(TOPMAN_TOUR_COMPLETED_KEY);
  } catch {
    // ignore
  }
}

export function shouldAutoStartGuidedTour(): boolean {
  return !isGuidedTourDismissed();
}
