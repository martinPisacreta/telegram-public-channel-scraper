import { normalizeInput, matchesKeywords } from './input.mjs';
import { fetchChannel } from './channel.mjs';
import { affordableMessageCount, allocateChannelBudgets, chargeEvent, RUN_EVENT, MESSAGE_EVENT, MAX_BATCH_SIZE } from './billing.mjs';

export async function main(actor, { fetchChannel: fetchChannelImpl = fetchChannel } = {}) {
  const input = normalizeInput(await actor.getInput());
  const started = await chargeEvent(actor, RUN_EVENT);
  const requested = input.channels.length * input.maxMessagesPerChannel;
  const allowance = started.stop || started.processedCount !== 1
    ? 0 : await affordableMessageCount(actor, requested);
  const budgets = allocateChannelBudgets(input.channels, input.maxMessagesPerChannel, allowance);
  const report = [];
  const saved = new Set();
  let billingStopped = false;

  for (const budget of budgets) {
    const row = { channel: budget.channel, messages: 0, pages: 0, error: null };
    report.push(row);
    if (budget.maxMessages === 0 || billingStopped) {
      row.error = 'Skipped: spending limit reached';
      continue;
    }

    let result;
    try {
      result = await fetchChannelImpl(budget.channel, {
        maxMessages: budget.maxMessages,
        sinceDate: input.sinceDate,
      });
    } catch (error) {
      row.pages = Number.isSafeInteger(error?.pages) && error.pages >= 0 ? error.pages : 0;
      row.error = error instanceof Error ? error.message : String(error);
      continue;
    }
    row.pages = result.pages;
    const selected = [];
    const pending = new Set();
    for (const message of result.messages) {
      const key = message.channel.toLowerCase() + '/' + message.messageId;
      if (saved.has(key) || pending.has(key) || !matchesKeywords(message.text, input.keywords)) continue;
      selected.push(message);
      pending.add(key);
      if (selected.length >= budget.maxMessages) break;
    }

    for (let offset = 0; offset < selected.length; offset += MAX_BATCH_SIZE) {
      const batch = selected.slice(offset, offset + MAX_BATCH_SIZE);
      // Storage and charging failures propagate. Neither operation is retried.
      await actor.pushData(batch);
      row.messages += batch.length;
      for (const message of batch) saved.add(message.channel.toLowerCase() + '/' + message.messageId);
      const charged = await chargeEvent(actor, MESSAGE_EVENT, batch.length);
      if (charged.processedCount !== batch.length) {
        throw new Error('Spending limit prevented charging every saved message; charge was not retried');
      }
      if (charged.stop) {
        billingStopped = true;
        if (offset + batch.length < selected.length) {
          row.error = 'Stopped: spending limit reached';
        }
        break;
      }
    }
  }

  const output = {
    report,
    totals: {
      requestedChannels: input.channels.length,
      succeededChannels: report.filter(row => row.error === null).length,
      failedChannels: report.filter(row => row.error !== null && !row.error.startsWith('Skipped:')).length,
      skippedChannels: report.filter(row => row.error?.startsWith('Skipped:')).length,
      messages: report.reduce((sum, row) => sum + row.messages, 0),
      pages: report.reduce((sum, row) => sum + row.pages, 0),
    },
  };
  await actor.setValue('OUTPUT', output);
  return output;
}
