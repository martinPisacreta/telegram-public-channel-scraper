import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInput, matchesKeywords } from '../src/input.mjs';

test('normalizes channel strings and objects with default limits', () => {
  const result = normalizeInput({ channels: ['@Telegram', { channel: 'https://t.me/s/durov' }] });
  assert.deepEqual(result.channels, ['telegram', 'durov']);
  assert.equal(result.maxMessagesPerChannel, 50);
  assert.deepEqual(result.keywords, []);
  assert.equal(result.sinceDate, undefined);
});

test('rejects invalid channel lists and message limits', () => {
  for (const channels of [[], Array(51).fill('telegram'), ['bad!'], [{}], [null]]) {
    assert.throws(() => normalizeInput({ channels }));
  }
  for (const maxMessagesPerChannel of [0, 1001, 1.5, '20', null]) {
    assert.throws(() => normalizeInput({ channels: ['telegram'], maxMessagesPerChannel }), /maxMessagesPerChannel/);
  }
  for (const maxMessagesPerChannel of [1, 1000]) {
    assert.equal(normalizeInput({ channels: ['telegram'], maxMessagesPerChannel }).maxMessagesPerChannel, maxMessagesPerChannel);
  }
});

test('accepts ISO dates and rejects impossible dates', () => {
  assert.equal(normalizeInput({ channels: ['telegram'], sinceDate: '2026-11-01' }).sinceDate, '2026-11-01T00:00:00.000Z');
  assert.equal(normalizeInput({ channels: ['telegram'], sinceDate: '2026-11-01T03:00:00+03:00' }).sinceDate, '2026-11-01T00:00:00.000Z');
  for (const sinceDate of ['2026-02-30', '2026-13-01', 'yesterday', '', 123]) {
    assert.throws(() => normalizeInput({ channels: ['telegram'], sinceDate }), /sinceDate/);
  }
});

test('keyword filtering matches any term without case sensitivity', () => {
  const { keywords } = normalizeInput({ channels: ['telegram'], keywords: [' Bot ', 'NEWS', 'bot'] });
  assert.deepEqual(keywords, ['bot', 'news']);
  assert.equal(matchesKeywords('New BOT features', keywords), true);
  assert.equal(matchesKeywords('Latest news', keywords), true);
  assert.equal(matchesKeywords('Unrelated message', keywords), false);
  assert.equal(matchesKeywords('', []), true);
  assert.equal(matchesKeywords(null, keywords), false);
});

test('rejects malformed keywords without mutating the input', () => {
  for (const keywords of ['news', [null], [''], ['   '], [1]]) {
    assert.throws(() => normalizeInput({ channels: ['telegram'], keywords }), /keywords/);
  }
  const input = { channels: ['@Telegram'], keywords: [' NEWS '] };
  normalizeInput(input);
  assert.deepEqual(input, { channels: ['@Telegram'], keywords: [' NEWS '] });
});
