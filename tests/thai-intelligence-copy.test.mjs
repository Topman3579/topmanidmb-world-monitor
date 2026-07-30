import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mistranslation = `ข่าว${'กรรมการ'}`;
const trackedCopyFiles = [
  'src/locales/th.json',
  'pro-test/src/locales/th.json',
  'public/offline.html',
  ...readdirSync(join(ROOT, 'public/pro/assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `public/pro/assets/${name}`),
];

test('Thai intelligence copy does not regress to the committee mistranslation', () => {
  for (const relativePath of trackedCopyFiles) {
    const source = readFileSync(join(ROOT, relativePath), 'utf8');
    assert.equal(source.includes(mistranslation), false, relativePath);
  }
});

test('Thai shell metadata uses clear intelligence wording', () => {
  const locale = JSON.parse(readFileSync(join(ROOT, 'src/locales/th.json'), 'utf8'));

  assert.equal(
    locale.shell.documentTitle,
    'World Monitor — แดชบอร์ดข่าวกรองระดับโลกแบบเรียลไทม์',
  );
  assert.equal(locale.shell.offlineTitle, 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต');
  assert.match(locale.shell.metaDescription, /ข่าวกรองระดับโลก/);
  assert.match(locale.shell.offlineMessage, /ข่าวกรองแบบเรียลไทม์/);
  assert.match(
    readFileSync(join(ROOT, 'public/offline.html'), 'utf8'),
    /th: \{ title: "ไม่มีการเชื่อมต่ออินเทอร์เน็ต"/,
  );
});
