const OPTIONAL_RUNTIME_CHUNK_PATH =
  /^\/assets\/(?:GlobeMap|MapContainer|maplibre|deck-stack|protomaps|h3-js|hls|sentry|panels|UnifiedSettings|settings-window|checkout)-[^/]+\.js$/i;

interface ResourceTimingSource {
  getEntriesByType(type: string): ArrayLike<{ name: string }>;
}

interface ServiceWorkerControlSource {
  controller: unknown;
  addEventListener(type: 'controllerchange', listener: EventListener, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: 'controllerchange', listener: EventListener): void;
}

interface OptionalRuntimeChunkWarmupOptions {
  serviceWorker?: ServiceWorkerControlSource;
  performance?: ResourceTimingSource;
  fetchFn?: typeof fetch;
  pageUrl?: string;
}

export function collectLoadedOptionalRuntimeChunkUrls(
  entries: ArrayLike<{ name: string }>,
  pageUrl: string,
): string[] {
  const page = new URL(pageUrl);
  const urls = new Set<string>();

  for (const entry of Array.from(entries)) {
    try {
      const url = new URL(entry.name, page);
      if (url.origin !== page.origin || !OPTIONAL_RUNTIME_CHUNK_PATH.test(url.pathname)) continue;
      urls.add(url.href);
    } catch {
      // Ignore malformed timing entries. They are browser telemetry, not
      // trusted input to the service-worker cache.
    }
  }

  return [...urls];
}

export function installOptionalRuntimeChunkWarmup(
  options: OptionalRuntimeChunkWarmupOptions = {},
): () => void {
  const serviceWorker = options.serviceWorker
    ?? (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined);
  const performanceSource = options.performance
    ?? (typeof performance !== 'undefined' ? performance : undefined);
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const pageUrl = options.pageUrl
    ?? (typeof location !== 'undefined' ? location.href : undefined);

  if (!serviceWorker || !performanceSource || typeof fetchFn !== 'function' || !pageUrl) {
    return () => {};
  }

  let disposed = false;
  let started = false;

  const warmLoadedChunks = async (): Promise<void> => {
    if (disposed || started || !serviceWorker.controller) return;
    started = true;

    const urls = collectLoadedOptionalRuntimeChunkUrls(
      performanceSource.getEntriesByType('resource'),
      pageUrl,
    );

    // These URLs were already downloaded by this page before the new worker
    // gained control. Re-request only that observed set through the controller
    // so Workbox can populate optional-runtime-chunks without speculative
    // first-visit downloads.
    await Promise.allSettled(urls.map((url) => fetchFn(url, {
      method: 'GET',
      cache: 'force-cache',
      credentials: 'same-origin',
    })));
  };

  const onControllerChange: EventListener = () => {
    serviceWorker.removeEventListener('controllerchange', onControllerChange);
    void warmLoadedChunks();
  };

  if (serviceWorker.controller) {
    void warmLoadedChunks();
  } else {
    serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
  }

  return () => {
    disposed = true;
    serviceWorker.removeEventListener('controllerchange', onControllerChange);
  };
}
