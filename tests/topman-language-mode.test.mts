import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  TOPMAN_LANGUAGE_MODE_KEY,
  getTopmanBrandSubtitle,
  getTopmanLanguageMode,
  getTopmanProductMission,
  getTopmanProductName,
  getTopmanWorkflowTag,
  readRequestedTopmanLanguageModeFromUrl,
  storedTopmanLanguageMode,
  topmanText,
} from '../src/services/topman-language-mode.ts';

const EXPLICIT_LOCALE_KEY = 'wm-locale-explicit';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
let originalLocalStorage: PropertyDescriptor | undefined;
let originalWindow: PropertyDescriptor | undefined;

function setWindowUrl(href: string): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { href } },
  });
}

before(() => {
  originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
});

beforeEach(() => {
  storage.clear();
  setWindowUrl('https://topmanidmb-world-monitor.vercel.app/');
});

after(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;

  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as { window?: unknown }).window;
});

describe('TOPMAN language mode', () => {
  it('renders Thai-only text when the stored mode is th', () => {
    storage.setItem(TOPMAN_LANGUAGE_MODE_KEY, 'th');

    assert.equal(storedTopmanLanguageMode(), 'th');
    assert.equal(getTopmanLanguageMode(), 'th');
    assert.equal(topmanText('ภาษาไทย', 'English'), 'ภาษาไทย');
  });

  it('renders Thai-first bilingual text when the stored mode is bilingual', () => {
    storage.setItem(TOPMAN_LANGUAGE_MODE_KEY, 'bilingual');

    assert.equal(getTopmanLanguageMode(), 'bilingual');
    assert.equal(topmanText('ภาษาไทย', 'English'), 'ภาษาไทย / English');
  });

  it('preserves an explicit English locale when no TOPMAN mode is stored', () => {
    storage.setItem(EXPLICIT_LOCALE_KEY, 'en');

    assert.equal(getTopmanLanguageMode(), 'en');
    assert.equal(topmanText('ภาษาไทย', 'English'), 'English');
  });

  it('uses URL mode before stored mode and explicit locale', () => {
    storage.setItem(TOPMAN_LANGUAGE_MODE_KEY, 'th');
    storage.setItem(EXPLICIT_LOCALE_KEY, 'en');
    setWindowUrl('https://topmanidmb-world-monitor.vercel.app/?topmanMode=bilingual');

    assert.equal(readRequestedTopmanLanguageModeFromUrl(), 'bilingual');
    assert.equal(getTopmanLanguageMode(), 'bilingual');
    assert.equal(topmanText('ภาษาไทย', 'English'), 'ภาษาไทย / English');
  });

  it('ignores invalid URL and storage values', () => {
    storage.setItem(TOPMAN_LANGUAGE_MODE_KEY, 'unsupported');
    setWindowUrl('https://topmanidmb-world-monitor.vercel.app/?topmanMode=invalid');

    assert.equal(readRequestedTopmanLanguageModeFromUrl(), null);
    assert.equal(storedTopmanLanguageMode(), null);
    assert.equal(getTopmanLanguageMode(), 'bilingual');
  });

  it('locks TOPMAN News Room product naming for command briefing', () => {
    storage.setItem(TOPMAN_LANGUAGE_MODE_KEY, 'th');
    assert.equal(getTopmanProductName(), 'TOPMAN News Room');
    assert.match(getTopmanBrandSubtitle(), /ภาพรวมสถานการณ์ · โฟกัสไทย/);
    assert.match(getTopmanProductMission(), /สั่งการของผู้บังคับบัญชา/);
    assert.match(getTopmanWorkflowTag(), /รวบรวม · เรียบเรียง · วิเคราะห์ · นำเสนอ/);
  });
});
