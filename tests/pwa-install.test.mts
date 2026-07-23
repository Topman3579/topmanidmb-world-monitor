import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyInstallSurface,
  isIosLike,
  isStandaloneDisplay,
} from '../src/services/pwa-install.ts';

describe('PWA install experience', () => {
  it('recognizes iPhone, iPad, and touch-capable iPadOS desktop user agents', () => {
    assert.equal(isIosLike('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), true);
    assert.equal(isIosLike('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), true);
    assert.equal(isIosLike('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5), true);
    assert.equal(isIosLike('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 0), false);
  });

  it('treats either browser display mode or iOS standalone flag as installed', () => {
    assert.equal(isStandaloneDisplay(true, false), true);
    assert.equal(isStandaloneDisplay(false, true), true);
    assert.equal(isStandaloneDisplay(false, false), false);
  });

  it('prioritizes installed/native shells, then iOS guidance, then native prompt', () => {
    assert.equal(classifyInstallSurface({ installed: true, iosLike: true, hasPrompt: true }), 'installed');
    assert.equal(classifyInstallSurface({ installed: false, iosLike: true, hasPrompt: true }), 'ios');
    assert.equal(classifyInstallSurface({ installed: false, iosLike: false, hasPrompt: true }), 'prompt');
    assert.equal(classifyInstallSurface({ installed: false, iosLike: false, hasPrompt: false }), 'unavailable');
    assert.equal(
      classifyInstallSurface({
        installed: false,
        iosLike: false,
        hasPrompt: true,
        isDesktopShell: true,
      }),
      'installed',
    );
  });
});
