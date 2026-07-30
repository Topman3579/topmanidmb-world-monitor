import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const welcomePath = resolve(__dirname, '../public/topman-welcome.html');
const welcomeHtml = readFileSync(welcomePath, 'utf-8').replace(/\r\n/g, '\n');
const welcomeSourceScript = readFileSync(
  resolve(__dirname, '../public/topman-welcome-source.js'),
  'utf-8'
).replace(/\r\n/g, '\n');
const vercelConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../vercel.json'), 'utf-8')
);

const TOPMAN_HOST_PATTERN = '^topmanidmb-world-monitor\\.vercel\\.app$';
const UPSTREAM_HOST_PATTERN = '^(?:(?:www|tech|finance|commodity|happy|energy)\\.)?worldmonitor\\.app$';
const STATIC_SCRIPT_NONCE = 'wm-static-bootstrap';
const healthScript = [...welcomeHtml.matchAll(
  /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
)].find(([, , source]) => source.includes('const HEALTH_URL'))?.[2];

async function renderLandingHealth(payload, {
  ok = true,
  status = 200,
} = {}) {
  assert.ok(healthScript, 'health bootstrap script must exist');

  const element = () => ({
    dataset: {},
    textContent: '',
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    addEventListener() {},
  });
  const elements = new Map([
    ['health-card', element()],
    ['health-label', element()],
    ['health-detail', element()],
    ['health-time', element()],
    ['health-counts', element()],
    ['health-refresh', element()],
  ]);

  const sandbox = {
    document: {
      visibilityState: 'visible',
      getElementById(id) {
        return elements.get(id) ?? null;
      },
      addEventListener() {},
    },
    window: {
      setInterval() {
        return 1;
      },
      setTimeout,
      clearTimeout,
    },
    fetch: async () => ({
      ok,
      status,
      json: async () => payload,
    }),
    Intl,
    Date,
    AbortController,
    DOMException,
  };

  vm.runInNewContext(healthScript, sandbox);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  return {
    state: elements.get('health-card').dataset.state,
    label: elements.get('health-label').textContent,
    detail: elements.get('health-detail').textContent,
    counts: elements.get('health-counts').textContent,
  };
}

const rootRewrites = vercelConfig.rewrites.filter((rewrite) => rewrite.source === '/');
const hostRewrite = (host) => rootRewrites.find((rewrite) => {
  if ((rewrite.has ?? []).some((condition) => condition.type === 'query')) return false;
  const condition = (rewrite.has ?? []).find((candidate) => candidate.type === 'host');
  return condition ? new RegExp(condition.value).test(host) : true;
});

describe('TOPMAN Thai-first welcome landing', () => {
  it('routes only the TOPMAN production host to the TOPMAN landing', () => {
    const topmanRewrite = hostRewrite('topmanidmb-world-monitor.vercel.app');
    const upstreamRewrite = hostRewrite('worldmonitor.app');

    assert.equal(topmanRewrite?.destination, '/topman-welcome.html');
    assert.deepEqual(topmanRewrite?.has, [{ type: 'host', value: TOPMAN_HOST_PATTERN }]);
    assert.equal(upstreamRewrite?.destination, '/pro/welcome.html');
    assert.deepEqual(upstreamRewrite?.has, [{ type: 'host', value: UPSTREAM_HOST_PATTERN }]);
    assert.equal(hostRewrite('topmanidmb-world-monitor.vercel.app.evil.example'), undefined);
  });

  it('uses Thai-first copy, the approved Orbit asset, and the dashboard CTA', () => {
    assert.match(welcomeHtml, /<html lang="th">/);
    assert.match(welcomeHtml, /รู้ก่อนข่าว[\s\S]*เข้าใจก่อนเหตุการณ์/);
    assert.match(
      welcomeHtml,
      /ศูนย์บัญชาการสถานการณ์โลก[\s\S]*สำหรับประเทศไทยและอาเซียน/
    );
    assert.match(welcomeHtml, /src="\/brand\/topmanidmb-orbit-emblem\.png"/);
    assert.match(welcomeHtml, /href="\/dashboard"/);
  });

  it('shows honest health states from the dedicated TOPMAN core endpoint', () => {
    assert.match(welcomeHtml, /const HEALTH_URL = "\/api\/topman-core-status"/);
    assert.match(welcomeHtml, /cache: "no-store"/);
    assert.match(welcomeHtml, /พร้อมบางส่วน/);
    assert.match(welcomeHtml, /ข้อมูลล่าช้า/);
    assert.match(welcomeHtml, /ตรวจสอบไม่ได้/);
    assert.match(welcomeHtml, /HEALTH_CHECK_MAX_AGE_MS = 5 \* 60 \* 1000/);
    assert.match(welcomeHtml, /HEALTH_REQUEST_TIMEOUT_MS = 10 \* 1000/);
    assert.match(welcomeHtml, /healthRequestGeneration/);
    assert.match(welcomeHtml, /activeHealthController\?\.abort\(\)/);
    assert.match(welcomeHtml, /role="status"/);
    assert.match(welcomeHtml, /aria-live="polite"/);
    assert.doesNotMatch(
      welcomeHtml,
      /data-state="ready"[^>]*>\s*<span/,
      'static fallback must not claim the data is ready before the API responds'
    );
  });

  it('classifies a partially available TOPMAN Core 6 snapshot honestly', async () => {
    const result = await renderLandingHealth({
      status: 'UNHEALTHY',
      checkedAt: new Date().toISOString(),
      summary: {
        total: 6,
        ok: 2,
        warn: 0,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 4,
      },
    });

    assert.equal(result.state, 'partial');
    assert.equal(result.label, 'ข้อมูลหลักพร้อมบางส่วน');
    assert.match(result.counts, /TOPMAN Core 6 ชุด/);
    assert.match(result.counts, /ผ่าน 2\/6/);
    assert.match(result.counts, /วิกฤต 4/);
  });

  it('renders HEALTHY as ready only when every validated count is OK', async () => {
    const ready = await renderLandingHealth({
      status: 'HEALTHY',
      checkedAt: new Date().toISOString(),
      summary: {
        total: 6,
        ok: 6,
        warn: 0,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 0,
      },
    });
    const partial = await renderLandingHealth({
      status: 'UNHEALTHY',
      checkedAt: new Date().toISOString(),
      summary: {
        total: 6,
        ok: 5,
        warn: 0,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 1,
      },
    });
    const unavailable = await renderLandingHealth({
      status: 'HEALTHY',
      checkedAt: new Date().toISOString(),
      summary: {
        total: 6,
        ok: 0,
        warn: 0,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 6,
      },
    });
    const warning = await renderLandingHealth({
      status: 'WARNING',
      checkedAt: new Date().toISOString(),
      summary: {
        total: 6,
        ok: 5,
        warn: 1,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 0,
      },
    });
    const onDemand = await renderLandingHealth({
      status: 'HEALTHY',
      checkedAt: new Date().toISOString(),
      summary: {
        total: 6,
        ok: 5,
        warn: 0,
        onDemandWarn: 1,
        staleContent: 0,
        crit: 0,
      },
    });

    assert.equal(ready.state, 'ready');
    assert.equal(partial.state, 'partial');
    assert.equal(unavailable.state, 'unavailable');
    assert.equal(warning.state, 'partial');
    assert.equal(onDemand.state, 'unavailable');
  });

  it('fails closed for contradictory counts, future timestamps, and non-2xx responses', async () => {
    const contradictory = await renderLandingHealth({
      status: 'HEALTHY',
      checkedAt: new Date().toISOString(),
      summary: {
        total: 6,
        ok: 6,
        warn: 0,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 1,
      },
    });
    const future = await renderLandingHealth({
      status: 'HEALTHY',
      checkedAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      summary: {
        total: 6,
        ok: 6,
        warn: 0,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 0,
      },
    });
    const httpFailure = await renderLandingHealth({
      status: 'HEALTHY',
      checkedAt: new Date().toISOString(),
      summary: {
        total: 6,
        ok: 6,
        warn: 0,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 0,
      },
    }, { ok: false, status: 500 });

    assert.equal(contradictory.state, 'unavailable');
    assert.equal(future.state, 'unavailable');
    assert.equal(httpFailure.state, 'unavailable');
  });

  it('rejects non-Core-6 summary totals', async () => {
    for (const total of [5, 10]) {
      const result = await renderLandingHealth({
        status: 'HEALTHY',
        checkedAt: new Date().toISOString(),
        summary: {
          total,
          ok: total,
          warn: 0,
          onDemandWarn: 0,
          staleContent: 0,
          crit: 0,
        },
      });
      assert.equal(result.state, 'unavailable');
    }
  });

  it('gives stale health priority across status families', async () => {
    const oldCheckedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    const staleCritical = await renderLandingHealth({
      status: 'UNHEALTHY',
      checkedAt: oldCheckedAt,
      summary: {
        total: 6,
        ok: 2,
        warn: 0,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 4,
      },
    });
    const staleWarning = await renderLandingHealth({
      status: 'WARNING',
      checkedAt: oldCheckedAt,
      summary: {
        total: 6,
        ok: 4,
        warn: 2,
        onDemandWarn: 0,
        staleContent: 0,
        crit: 0,
      },
    });

    assert.equal(staleCritical.state, 'delayed');
    assert.equal(staleWarning.state, 'delayed');
  });

  it('fails neutral until the deployed TOPMAN commit is verified, with upstream and AGPL attribution', () => {
    assert.match(
      welcomeHtml,
      /href="https:\/\/github\.com\/Topman3579\/topmanidmb-world-monitor"/
    );
    assert.match(welcomeHtml, /กำลังยืนยัน revision ที่เผยแพร่/);
    assert.doesNotMatch(welcomeHtml, /\/commit\/[0-9a-f]{40}/);
    assert.doesNotMatch(welcomeHtml, /\/tree\/codex\/world-command-center-v2/);
    assert.match(
      welcomeHtml,
      /<script src="\/topman-welcome-source\.js" defer nonce="wm-static-bootstrap"><\/script>/
    );
    assert.match(welcomeSourceScript, /\/build-hash\.txt\?t=\$\{Date\.now\(\)\}/);
    assert.match(welcomeSourceScript, /cache: 'no-store'/);
    assert.match(welcomeSourceScript, /\/commit\/\$\{hash\}/);
    assert.match(welcomeHtml, /https:\/\/github\.com\/koala73\/worldmonitor/);
    assert.match(welcomeHtml, /Based on[\s\S]*World Monitor/);
    assert.match(welcomeHtml, /AGPL-3\.0/);
  });

  it('does not repeat upstream pricing, adoption, or superiority claims', () => {
    assert.doesNotMatch(welcomeHtml, /\$39\.99|2M\+|2 million|สองล้าน|WIRED/i);
    assert.doesNotMatch(welcomeHtml, /เหนือกว่า|ดีที่สุดในโลก|อันดับหนึ่ง/i);
    assert.doesNotMatch(welcomeHtml, /pricing|ราคาแพ็กเกจ|สมัครสมาชิก/i);
  });

  it('keeps inline scripts CSP-compatible and includes core accessibility guards', () => {
    const inlineScripts = [
      ...welcomeHtml.matchAll(/<script\b(?![^>]*\bsrc=)([^>]*)>[\s\S]*?<\/script>/gi),
    ];
    assert.ok(inlineScripts.length >= 2, 'expected structured data and health scripts');
    for (const [, attributes] of inlineScripts) {
      assert.match(
        attributes,
        new RegExp(`\\bnonce=["']${STATIC_SCRIPT_NONCE}["']`),
        'every inline script must use the nonce trusted by the global CSP'
      );
    }

    assert.match(welcomeHtml, /class="skip-link"/);
    assert.match(welcomeHtml, /:focus-visible/);
    assert.match(welcomeHtml, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(welcomeHtml, /@media \(max-width: 720px\)/);
  });
});
