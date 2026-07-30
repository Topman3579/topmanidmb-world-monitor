import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/styles/main.css'), 'utf8');
const viteConfig = readFileSync(resolve(here, '../vite.config.ts'), 'utf8');

describe('mobile commander lite', () => {
  it('keeps the boot footprint and compacts only the hydrated mobile map', () => {
    assert.match(css, /height:\s*calc\(100dvh - 48px/);
    assert.match(
      css,
      /html\.wm-layout-hydrated \.main-content \.map-section:not\(\.collapsed\):not\(\.live-news-fullscreen\)\s*\{[\s\S]*height:\s*clamp\(300px,\s*45dvh,\s*460px\)\s*!important;[\s\S]*min-height:\s*300px\s*!important;/
    );
  });

  it('promotes the intelligence rail and exposes touch-sized commander controls', () => {
    assert.match(
      css,
      /html\.wm-layout-hydrated \.main-content \.mobile-panel-nav\s*\{[\s\S]*order:\s*-1;/
    );
    assert.match(
      css,
      /\.hamburger-btn,[\s\S]*\.mission-preset-reset,[\s\S]*\.mission-preset-close,[\s\S]*\.mobile-panel-nav-chip,[\s\S]*\.map-dim-btn,[\s\S]*\.panel-error-retry-btn,[\s\S]*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px;/
    );
    assert.match(
      css,
      /html\.wm-layout-hydrated \.topman-pwa-install__action,[\s\S]*html\.wm-layout-hydrated \.topman-pwa-install__close\s*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px;/
    );
    assert.match(
      css,
      /html\.wm-layout-hydrated \.site-footer\s*\{[\s\S]*min-height:\s*56px;[\s\S]*overflow-x:\s*auto;/
    );
  });

  it('preserves actionable update and error truth in compact mobile states', () => {
    assert.match(css, /\.update-toast-detail\s*\{\s*display:\s*none;/);
    assert.match(css, /\.panel-error-radar\s*\{\s*display:\s*none;/);
    assert.match(css, /\.panel-error-msg\s*\{[\s\S]*max-width:/);
    assert.match(css, /\.panel-error-retry-btn,[\s\S]*\.config-error-settings-btn\s*\{/);
  });
});

describe('PWA core-shell precache', () => {
  const ignoredOptionalChunks = [
    '**/GlobeMap-*.js',
    '**/MapContainer-*.js',
    '**/maplibre-*.js',
    '**/deck-stack-*.js',
    '**/protomaps-*.js',
    '**/h3-js-*.js',
    '**/hls-*.js',
    '**/sentry-*.js',
    '**/panels-*.js',
    '**/UnifiedSettings-*.js',
    '**/settings-window-*.js',
    '**/checkout-*.js',
  ];

  it('keeps heavyweight optional chunks out of install-time work', () => {
    for (const pattern of ignoredOptionalChunks) {
      assert.ok(viteConfig.includes(`'${pattern}'`), `missing Workbox ignore: ${pattern}`);
    }
    assert.match(viteConfig, /maximumFileSizeToCacheInBytes:\s*2 \* 1024 \* 1024/);
  });

  it('caches optional chunks after first use without caching API responses', () => {
    assert.match(viteConfig, /cacheName:\s*'optional-runtime-chunks'/);
    assert.match(
      viteConfig,
      /\/\^\\\/assets\\\/\(\?:GlobeMap\|MapContainer\|maplibre\|deck-stack\|protomaps\|h3-js\|hls\|sentry\|panels\|UnifiedSettings\|settings-window\|checkout\)-\[\^\/\]\+\\\.js\$\/i/
    );
    assert.match(viteConfig, /cacheName:\s*'optional-runtime-chunks'[\s\S]*cacheableResponse:\s*\{\s*statuses:\s*\[200\]\s*\}/);
    assert.match(viteConfig, /\^\\\/api\\\/[\s\S]*handler:\s*'NetworkOnly'/);
  });
});
