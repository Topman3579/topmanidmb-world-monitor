import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectLoadedOptionalRuntimeChunkUrls,
  installOptionalRuntimeChunkWarmup,
} from '../src/bootstrap/pwa-optional-chunk-cache';

describe('optional PWA runtime chunk warmup', () => {
  it('selects only loaded same-origin optional chunks and de-duplicates them', () => {
    const urls = collectLoadedOptionalRuntimeChunkUrls([
      { name: 'https://example.test/assets/MapContainer-abc123.js' },
      { name: '/assets/panels-news-def456.js' },
      { name: 'https://example.test/assets/MapContainer-abc123.js' },
      { name: 'https://cdn.example/assets/maplibre-abc123.js' },
      { name: 'https://example.test/assets/index-abc123.js' },
      { name: 'https://example.test/api/health?compact=1' },
    ], 'https://example.test/dashboard');

    assert.deepEqual(urls, [
      'https://example.test/assets/MapContainer-abc123.js',
      'https://example.test/assets/panels-news-def456.js',
    ]);
  });

  it('waits for service-worker control, then re-requests only the observed chunks once', async () => {
    let controller: unknown = null;
    let listener: EventListener | null = null;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const serviceWorker = {
      get controller() {
        return controller;
      },
      addEventListener(type: 'controllerchange', next: EventListener) {
        assert.equal(type, 'controllerchange');
        listener = next;
      },
      removeEventListener(type: 'controllerchange', next: EventListener) {
        assert.equal(type, 'controllerchange');
        if (listener === next) listener = null;
      },
    };

    const dispose = installOptionalRuntimeChunkWarmup({
      serviceWorker,
      performance: {
        getEntriesByType: () => [
          { name: 'https://example.test/assets/GlobeMap-abc123.js' },
          { name: 'https://example.test/assets/index-def456.js' },
        ],
      },
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response('', { status: 200 });
      }) as typeof fetch,
      pageUrl: 'https://example.test/dashboard',
    });

    assert.equal(calls.length, 0, 'first visit must not warm before the worker controls the page');
    controller = {};
    listener?.(new Event('controllerchange'));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://example.test/assets/GlobeMap-abc123.js');
    assert.equal(calls[0]?.init?.cache, 'force-cache');
    assert.equal(calls[0]?.init?.credentials, 'same-origin');

    dispose();
  });

  it('does nothing when browser service-worker primitives are unavailable', () => {
    assert.doesNotThrow(() => installOptionalRuntimeChunkWarmup({
      serviceWorker: undefined,
      performance: undefined,
      fetchFn: undefined,
      pageUrl: undefined,
    })());
  });
});
