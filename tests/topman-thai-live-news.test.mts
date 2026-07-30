/**
 * TOPMAN Thai live-news channel registry — keep Thailand-first defaults wired.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const liveNewsSrc = readFileSync(resolve(root, 'src/components/LiveNewsPanel.ts'), 'utf8');

const THAI_IDS = [
  'thai-pbs',
  'nation-tv',
  'tnn',
  'workpoint-news',
  'pptv-hd36',
  'thairath',
] as const;

const THAI_HANDLES: Record<(typeof THAI_IDS)[number], string> = {
  'thai-pbs': '@ThaiPBS',
  'nation-tv': '@NationTVOfficial',
  tnn: '@TNNCHANNEL',
  'workpoint-news': '@WorkpointNews',
  'pptv-hd36': '@PPTVHD36',
  thairath: '@Thairath',
};

describe('TOPMAN Thai live news channels', () => {
  it('registers six Thailand channels in OPTIONAL_LIVE_CHANNELS with YouTube handles', () => {
    for (const id of THAI_IDS) {
      const match = liveNewsSrc.match(new RegExp(`id:\\s*'${id}'[^}]*}`));
      assert.ok(match, `missing channel ${id}`);
      assert.match(match[0], new RegExp(`handle:\\s*'${THAI_HANDLES[id]}'`));
    }
  });

  it('lists Thailand channels first in the Asia optional region', () => {
    const asia = liveNewsSrc.match(/key:\s*'asia'[^}]*}/);
    assert.ok(asia, 'asia region missing');
    const ids = asia[0];
    let lastIndex = -1;
    for (const id of THAI_IDS) {
      const idx = ids.indexOf(`'${id}'`);
      assert.ok(idx !== -1, `${id} missing from asia region`);
      assert.ok(idx > lastIndex, `${id} should stay in Thailand-first asia order`);
      lastIndex = idx;
    }
  });

  it('puts Thailand channels before world defaults in FULL_LIVE_CHANNELS', () => {
    const fullBlock = liveNewsSrc.match(/const FULL_LIVE_CHANNELS: LiveChannel\[] = \[([\s\S]*?)\];/);
    assert.ok(fullBlock, 'FULL_LIVE_CHANNELS missing');
    const body = fullBlock[1];
    const thaiFirst = body.indexOf("id: 'thai-pbs'");
    const bloomberg = body.indexOf("id: 'bloomberg'");
    assert.ok(thaiFirst !== -1 && bloomberg !== -1);
    assert.ok(thaiFirst < bloomberg, 'Thai PBS must precede Bloomberg in full defaults');
    for (const id of THAI_IDS) {
      assert.match(body, new RegExp(`id:\\s*'${id}'`));
    }
  });
});
