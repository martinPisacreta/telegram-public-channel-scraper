import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePage, parseViews, decodeEntities } from '../src/parse.mjs';
import { fetchChannel, normalizeChannel } from '../src/channel.mjs';

const fixture = readFileSync(new URL('./fixtures/telegram-page.html', import.meta.url), 'utf8');
const dateFor = id => `2026-11-${String(id).padStart(2, '0')}T12:00:00.000Z`;

function page(ids, before = null) {
  const previous = before === null ? '' : `<link rel="prev" href="/s/telegram?before=${before}">`;
  return previous + ids.map(id => `<div class="tgme_widget_message_wrap"><div data-post="telegram/${id}"><div class="tgme_widget_message_text">Message ${id}<br>Second line</div><a class="tgme_widget_message_date"><time datetime="${dateFor(id)}"></time></a></div></div>`).join('');
}

function fakePages() {
  const calls = [];
  const responses = new Map([
    ['https://t.me/s/telegram', page([5, 6, 7], 5)],
    ['https://t.me/s/telegram?before=5', page([3, 4, 5], 3)],
    ['https://t.me/s/telegram?before=3', page([1, 2, 3])],
  ]);
  return { calls, getText: async url => {
    calls.push(url);
    assert.ok(responses.has(url), `Unexpected request: ${url}`);
    return responses.get(url);
  } };
}

test('saved public page contains the expected 20 messages', () => {
  const { messages, before } = parsePage(fixture);
  assert.equal(before, 441);
  assert.deepEqual(messages.map(message => message.messageId), Array.from({ length: 20 }, (_, index) => 441 + index));
  assert.equal(messages[0].date, '2026-05-14T16:08:31.000Z');
  assert.equal(messages.at(-1).date, '2026-08-26T19:12:34.000Z');
  assert.equal(messages[0].views, 1700000);
  assert.ok(messages[0].text.includes('Bot-to-Bot Communication.'));
  assert.ok(messages[0].text.includes('\n'));
  for (const message of messages) {
    assert.equal(message.channel, 'telegram');
    assert.equal(message.url, `https://t.me/telegram/${message.messageId}`);
    assert.ok(Number.isFinite(Date.parse(message.date)));
    assert.ok(message.views === null || Number.isSafeInteger(message.views));
    assert.doesNotMatch(message.text, /<\/?[a-z][^>]*>/i);
    assert.equal(new Set(message.links).size, message.links.length);
    assert.equal(typeof message.hasPhoto, 'boolean');
    assert.equal(typeof message.hasVideo, 'boolean');
    assert.equal(typeof message.isReply, 'boolean');
  }
});

test('views and numeric HTML entities are decoded', () => {
  assert.equal(parseViews('1.2M'), 1200000);
  assert.equal(parseViews('15.3K'), 15300);
  assert.equal(parseViews('123'), 123);
  assert.equal(parseViews(null), null);
  assert.equal(parseViews('unknown'), null);
  assert.equal(decodeEntities('&amp; &lt; &#65; &#x1F600;'), '& < A 😀');
});

test('channel identifiers and public URL forms normalize consistently', () => {
  for (const value of ['Telegram', '@telegram', 'https://t.me/telegram', 'https://t.me/s/telegram']) {
    assert.equal(normalizeChannel(value), 'telegram');
  }
  for (const value of ['abc', '1telegram', 'telegram/123', 'https://example.com/telegram', 'https://t.me/telegram?before=1', 'https://t.me/+invite']) {
    assert.throws(() => normalizeChannel(value), /Invalid channel/);
  }
});

test('three pages return unique messages from newest to oldest', async () => {
  const fake = fakePages();
  const result = await fetchChannel('@telegram', { maxMessages: 7, getText: fake.getText });
  assert.deepEqual(result.messages.map(message => message.messageId), [7, 6, 5, 4, 3, 2, 1]);
  assert.equal(result.pages, 3);
  assert.equal(fake.calls.length, 3);
});

test('message limit stops pagination before another request', async () => {
  const fake = fakePages();
  const result = await fetchChannel('telegram', { maxMessages: 2, getText: fake.getText });
  assert.deepEqual(result.messages.map(message => message.messageId), [7, 6]);
  assert.equal(result.pages, 1);
  assert.equal(fake.calls.length, 1);
});

test('sinceDate includes the boundary and stops after older messages', async () => {
  const fake = fakePages();
  const result = await fetchChannel('telegram', { maxMessages: 40, sinceDate: dateFor(5), getText: fake.getText });
  assert.deepEqual(result.messages.map(message => message.messageId), [7, 6, 5]);
  assert.equal(result.pages, 2);
  assert.equal(fake.calls.length, 2);
});

test('invalid inputs fail before requesting a page', async () => {
  let calls = 0;
  const getText = async () => { calls++; throw new Error('Unexpected request'); };
  await assert.rejects(fetchChannel('bad!', { getText }), /Invalid channel/);
  await assert.rejects(fetchChannel('telegram', { maxMessages: 0, getText }), /maxMessages/);
  await assert.rejects(fetchChannel('telegram', { sinceDate: 'invalid', getText }), /sinceDate/);
  assert.equal(calls, 0);
});

test('channel errors preserve their message and attempted page count', async () => {
  await assert.rejects(fetchChannel('telegram', { getText: async () => {
    throw new Error('Channel is not public or does not exist');
  } }), error => {
    assert.equal(error.message, 'Channel is not public or does not exist');
    assert.equal(error.channel, 'telegram');
    assert.equal(error.pages, 1);
    return true;
  });
});
