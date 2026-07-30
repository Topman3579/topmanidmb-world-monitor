import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');

const simpleModeTs = read('../src/components/TopmanSimpleMode.ts');
const simpleCss = read('../src/styles/topman-simple-mode.css');
const baseLayer = read('../src/styles/base-layer.css');
const panelLayout = read('../src/app/panel-layout.ts');
const appTs = read('../src/App.ts');
const mainTs = read('../src/main.ts');
const welcome = read('../public/topman-welcome.html');

describe('TOPMAN Simple Mode wiring', () => {
  it('imports simple-mode CSS through the brand cascade', () => {
    assert.match(baseLayer, /topman-simple-mode\.css/);
  });

  it('mounts simple mode root and mode toggles in the shell', () => {
    assert.match(panelLayout, /id="topmanSimpleModeRoot"/);
    assert.match(panelLayout, /id="topmanSimpleModeBelow"/);
    assert.match(panelLayout, /id="topmanModeToggle"/);
    assert.match(panelLayout, /id="mobileMenuTopmanMode"/);
  });

  it('boots ui-mode before layout and initializes the component from App', () => {
    assert.match(mainTs, /initTopmanUiMode/);
    assert.match(appTs, /initTopmanSimpleMode/);
    assert.match(appTs, /TopmanSimpleMode/);
  });

  it('keeps progressive disclosure constraints in CSS', () => {
    assert.match(simpleCss, /topman-ui-mode-simple/);
    assert.match(simpleCss, /min-height:\s*44px/);
    assert.match(simpleCss, /overflow-x:\s*hidden/);
    assert.match(simpleCss, /grid-template-columns:\s*repeat\(3/);
    assert.match(simpleCss, /#topmanSimpleModeBelow/);
    assert.match(simpleCss, /topman-tour-spotlight/);
    // Auth mount stays in layout for CLS/e2e header reservation (not display:none).
    assert.match(simpleCss, /\.auth-widget-mount\s*\{[\s\S]*opacity:/);
    assert.doesNotMatch(
      simpleCss,
      /topman-ui-mode-simple \.auth-widget-mount[^{]*\{[^}]*display:\s*none/,
    );
  });

  it('renders executive summary, three cards, missions, and tour controls', () => {
    assert.match(simpleModeTs, /data-tour="summary"/);
    assert.match(simpleModeTs, /data-tour="cards"/);
    assert.match(simpleModeTs, /data-tour="missions"/);
    assert.match(simpleModeTs, /data-tour="map-categories"/);
    assert.match(simpleModeTs, /data-action="start-tour"/);
    assert.match(simpleModeTs, /โหมดผู้เชี่ยวชาญ|Advanced Mode/);
    assert.match(simpleModeTs, /ดูรายละเอียด/);
    assert.match(simpleModeTs, /getTopmanProductName|TOPMAN News Room/);
    assert.match(simpleModeTs, /getTopmanProductMission/);
    assert.match(simpleModeTs, /install-pro-desks/);
    assert.match(simpleModeTs, /topman-pro-business-playbook/);
  });

  it('routes welcome CTAs into simple mode without inventing facts', () => {
    assert.match(welcome, /\/dashboard\?mode=simple/);
    assert.match(welcome, /ไม่สามารถตรวจสอบได้|พร้อมบางส่วน|ข้อมูลล่าช้า/);
  });

  it('does not claim full multi-source health from TOPMAN Core alone', () => {
    assert.match(
      simpleModeTs,
      /ไม่ใช่การยืนยันว่าระบบแหล่งข้อมูลทั้งหมดพร้อมสมบูรณ์|does not mean every external source/,
    );
  });
});
