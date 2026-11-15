import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/actor.mjs';
import { allocateChannelBudgets, affordableMessageCount, chargeEvent } from '../src/billing.mjs';

function fakeActor(input, { allowance = Infinity, charge, payPerEvent = true } = {}) {
  const events = [];
  const batches = [];
  const output = new Map();
  const order = [];
  const actor = {
    getInput: async () => input,
    getChargingManager: () => ({
      getPricingInfo: () => ({ isPayPerEvent: payPerEvent }),
      calculateMaxEventChargeCountWithinLimit: async event => {
        assert.equal(event, 'message');
        order.push('budget');
        return allowance;
      },
    }),
    charge: async request => {
      events.push({ ...request });
      order.push(request.eventName);
      return charge ? charge(request) : { chargedCount: request.count, eventChargeLimitReached: false };
    },
    pushData: async batch => {
      batches.push(structuredClone(batch));
      order.push('save');
    },
    setValue: async (key, value) => { output.set(key, value); },
  };
  return { actor, events, batches, output, order };
}

function message(channel, messageId, text = 'Public news') {
  return {
    channel, messageId, url: `https://t.me/${channel}/${messageId}`,
    date: '2026-11-01T12:00:00.000Z', text, views: 10,
    hasPhoto: false, hasVideo: false, photoUrls: [], links: [],
    forwardedFrom: null, isReply: false,
  };
}

test('invalid input causes no charge, page request or storage write', async () => {
  const fake = fakeActor({ channels: ['bad!'] });
  let requests = 0;
  await assert.rejects(main(fake.actor, { fetchChannel: async () => { requests++; } }));
  assert.equal(requests, 0);
  assert.deepEqual(fake.events, []);
  assert.deepEqual(fake.batches, []);
  assert.equal(fake.output.size, 0);
});

test('reserves capacity in channel order before fetching and skips unfunded channels', async () => {
  const fake = fakeActor({ channels: ['telegram', 'durov', 'other'], maxMessagesPerChannel: 2 }, { allowance: 3 });
  const calls = [];
  const result = await main(fake.actor, { fetchChannel: async (channel, options) => {
    fake.order.push('fetch');
    calls.push({ channel, maxMessages: options.maxMessages });
    return { pages: 1, messages: Array.from({ length: options.maxMessages }, (_, index) => message(channel, index + 1)) };
  } });
  assert.deepEqual(calls, [{ channel: 'telegram', maxMessages: 2 }, { channel: 'durov', maxMessages: 1 }]);
  assert.deepEqual(fake.order.slice(0, 3), ['run-started', 'budget', 'fetch']);
  assert.deepEqual(fake.events, [
    { eventName: 'run-started', count: 1 },
    { eventName: 'message', count: 2 },
    { eventName: 'message', count: 1 },
  ]);
  assert.equal(result.report[2].pages, 0);
  assert.equal(result.report[2].error, 'Skipped: spending limit reached');
  assert.deepEqual(result.totals, { requestedChannels: 3, succeededChannels: 2, failedChannels: 0, skippedChannels: 1, messages: 3, pages: 2 });
  assert.deepEqual(fake.output.get('OUTPUT'), result);
});

test('zero message allowance makes no page requests', async () => {
  const fake = fakeActor({ channels: ['telegram'] }, { allowance: 0 });
  const result = await main(fake.actor, { fetchChannel: async () => { throw new Error('Unexpected request'); } });
  assert.equal(result.totals.skippedChannels, 1);
  assert.equal(result.totals.pages, 0);
  assert.deepEqual(fake.events, [{ eventName: 'run-started', count: 1 }]);
});

test('an uncharged or limit-exhausting run event prevents page requests', async () => {
  for (const chargedCount of [0, 1]) {
    const fake = fakeActor({ channels: ['telegram'] }, {
      charge: async () => ({ chargedCount, eventChargeLimitReached: true }),
    });
    const result = await main(fake.actor, { fetchChannel: async () => { throw new Error('Unexpected request'); } });
    assert.equal(result.totals.skippedChannels, 1);
    assert.deepEqual(fake.order, ['run-started']);
  }
});

test('saves batches of at most 200 and charges each saved message once', async () => {
  const fake = fakeActor({ channels: ['telegram'], maxMessagesPerChannel: 201 });
  const rows = Array.from({ length: 201 }, (_, index) => message('telegram', 201 - index));
  const result = await main(fake.actor, { fetchChannel: async () => ({ pages: 11, messages: rows }) });
  assert.deepEqual(fake.batches.map(batch => batch.length), [200, 1]);
  assert.deepEqual(fake.batches.flat(), rows);
  assert.deepEqual(fake.events, [
    { eventName: 'run-started', count: 1 },
    { eventName: 'message', count: 200 },
    { eventName: 'message', count: 1 },
  ]);
  assert.equal(result.totals.messages, 201);
  assert.equal(result.totals.pages, 11);
  assert.deepEqual(fake.order.slice(2), ['save', 'message', 'save', 'message']);
});

test('filters keywords, removes repeated messages and passes sinceDate to the core', async () => {
  const fake = fakeActor({ channels: ['telegram'], keywords: ['BOT', 'news'], sinceDate: '2026-11-01' });
  const result = await main(fake.actor, { fetchChannel: async (channel, options) => {
    assert.equal(options.sinceDate, '2026-11-01T00:00:00.000Z');
    return { pages: 1, messages: [message(channel, 4, 'New bot'), message(channel, 4, 'New bot'), message(channel, 3, 'NEWS update'), message(channel, 2, 'Unrelated')] };
  } });
  assert.deepEqual(fake.batches.flat().map(row => row.messageId), [4, 3]);
  assert.equal(result.totals.messages, 2);
  assert.deepEqual(fake.events.at(-1), { eventName: 'message', count: 2 });
});

test('a failed channel does not prevent processing the next channel', async () => {
  const fake = fakeActor({ channels: ['telegram', 'durov'] });
  const calls = [];
  const result = await main(fake.actor, { fetchChannel: async channel => {
    calls.push(channel);
    if (channel === 'telegram') {
      const error = new Error('Channel is not public or does not exist');
      error.pages = 1;
      throw error;
    }
    return { pages: 1, messages: [message(channel, 1)] };
  } });
  assert.deepEqual(calls, ['telegram', 'durov']);
  assert.deepEqual(result.report[0], { channel: 'telegram', messages: 0, pages: 1, error: 'Channel is not public or does not exist' });
  assert.equal(result.report[1].messages, 1);
  assert.equal(result.totals.failedChannels, 1);
  assert.equal(result.totals.succeededChannels, 1);
});

test('a rejected message charge propagates without retry or another channel request', async () => {
  const fake = fakeActor({ channels: ['telegram', 'durov'] }, { charge: async request => {
    if (request.eventName === 'message') throw new Error('Ambiguous charging failure');
    return { chargedCount: 1, eventChargeLimitReached: false };
  } });
  const calls = [];
  await assert.rejects(main(fake.actor, { fetchChannel: async channel => {
    calls.push(channel);
    return { pages: 1, messages: [message(channel, 1)] };
  } }), /Ambiguous charging failure/);
  assert.deepEqual(calls, ['telegram']);
  assert.equal(fake.events.filter(event => event.eventName === 'message').length, 1);
  assert.equal(fake.batches.flat().length, 1);
});

test('storage failure does not charge unsaved messages or retry storage', async () => {
  const fake = fakeActor({ channels: ['telegram'] });
  let writes = 0;
  fake.actor.pushData = async () => { writes++; throw new Error('Storage failed'); };
  await assert.rejects(main(fake.actor, { fetchChannel: async () => ({ pages: 1, messages: [message('telegram', 1)] }) }), /Storage failed/);
  assert.equal(writes, 1);
  assert.deepEqual(fake.events, [{ eventName: 'run-started', count: 1 }]);
});

test('billing helpers reject unknown spending capacity and malformed charge responses', async () => {
  for (const allowance of [-1, NaN, 1.5, undefined]) {
    const actor = { getChargingManager: () => ({ getPricingInfo: () => ({ isPayPerEvent: true }), calculateMaxEventChargeCountWithinLimit: async () => allowance }) };
    await assert.rejects(affordableMessageCount(actor, 10), /Invalid affordable/);
  }
  await assert.rejects(affordableMessageCount({ charge() {} }, 10), /Cannot determine/);
  for (const response of [null, { chargedCount: 2, eventChargeLimitReached: false }, { chargedCount: 1 }]) {
    const fake = fakeActor({}, { charge: async () => response });
    await assert.rejects(chargeEvent(fake.actor, 'message', 1), /Invalid charging response/);
    assert.equal(fake.events.length, 1);
  }
  assert.deepEqual(allocateChannelBudgets(['telegram', 'durov', 'other'], 20, 25), [
    { channel: 'telegram', maxMessages: 20 },
    { channel: 'durov', maxMessages: 5 },
    { channel: 'other', maxMessages: 0 },
  ]);
});

test('non-pay-per-event runs save messages without invoking charging APIs', async () => {
  const fake = fakeActor({ channels: ['telegram'] }, { payPerEvent: false });
  const result = await main(fake.actor, { fetchChannel: async () => ({ pages: 1, messages: [message('telegram', 1)] }) });
  assert.equal(result.totals.messages, 1);
  assert.deepEqual(fake.events, []);
  assert.deepEqual(fake.order, ['save']);
});
