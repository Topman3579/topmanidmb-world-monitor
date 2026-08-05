import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isLineConfigured, pushLineTextMessage } from '../api/_topman-line-push.js';

describe('TOPMAN LINE push helper', () => {
  it('reports not configured without env', () => {
    assert.equal(isLineConfigured({}), false);
  });

  it('pushes text when token and to are present', async () => {
    const calls = [];
    const result = await pushLineTextMessage('สวัสดี', {
      token: 'test-token',
      to: 'U123',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response('{}', { status: 200 });
      },
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.match(String(calls[0].url), /api\.line\.me/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.to, 'U123');
    assert.equal(body.messages[0].text, 'สวัสดี');
  });

  it('returns LINE_NOT_CONFIGURED without credentials', async () => {
    const result = await pushLineTextMessage('x', {
      token: '',
      to: '',
      fetchImpl: async () => new Response('nope', { status: 500 }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'LINE_NOT_CONFIGURED');
  });
});
