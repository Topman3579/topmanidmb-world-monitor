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

const THAI_HLS: Record<(typeof THAI_IDS)[number], RegExp> = {
  'thai-pbs': /thaipbs-mcx0wm\.cdn\.byteark\.com\/live\/playlist\.m3u8/,
  'nation-tv': /nationtv-1jdcjo\.cdn\.byteark\.com\/fleetstream\/nationtvlive\/index\.m3u8/,
  tnn: /live-us1\.thaimomo\.com\/live-as\/chtnn24-2\/playlist\.m3u8/,
  'workpoint-news': /live-us1\.thaimomo\.com\/live-as\/chworkpointt-3\/playlist\.m3u8/,
  'pptv-hd36': /live-us1\.thaimomo\.com\/live-as\/chpptv-3\/playlist\.m3u8/,
  thairath: /live-us1\.thaimomo\.com\/live-as\/chthairathhd-3\/playlist\.m3u8/,
};

describe('TOPMAN Thai live news channels', () => {
  it('registers six Thailand channels in OPTIONAL_LIVE_CHANNELS with YouTube handles', () => {
    for (const id of THAI_IDS) {
      const match = liveNewsSrc.match(new RegExp(`id:\\s*'${id}'[^}]*}`));
      assert.ok(match, `missing channel ${id}`);
      assert.match(match[0], new RegExp(`handle:\\s*'${THAI_HANDLES[id]}'`));
    }
  });

  it('maps all six Thailand channels to playable DIRECT_HLS_MAP URLs', () => {
    const hlsMap = liveNewsSrc.match(/const DIRECT_HLS_MAP[^{]*\{([\s\S]*?)\};/);
    assert.ok(hlsMap, 'DIRECT_HLS_MAP missing');
    const body = hlsMap[1];
    for (const id of THAI_IDS) {
      const entry = body.match(new RegExp(`'${id}':\\s*'([^']+)'`));
      assert.ok(entry, `${id} missing from DIRECT_HLS_MAP`);
      assert.match(entry[1], /^https:\/\//);
      assert.match(entry[1], /\.m3u8/);
      assert.match(entry[1], THAI_HLS[id]);
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
