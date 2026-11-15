export const RUN_EVENT = 'run-started';
export const MESSAGE_EVENT = 'message';
export const MAX_BATCH_SIZE = 200;

function isPayPerEvent(actor) {
  const info = actor.getChargingManager?.()?.getPricingInfo?.();
  return info ? info.isPayPerEvent === true : typeof actor.charge === 'function';
}

export async function affordableMessageCount(actor, requested) {
  if (!Number.isSafeInteger(requested) || requested < 0) {
    throw new TypeError('Requested message count must be a nonnegative safe integer');
  }
  if (requested === 0 || !isPayPerEvent(actor)) return requested;
  const manager = actor.getChargingManager?.();
  if (typeof manager?.calculateMaxEventChargeCountWithinLimit !== 'function') {
    throw new Error('Cannot determine the spending limit; no pages will be requested');
  }
  const affordable = await manager.calculateMaxEventChargeCountWithinLimit(MESSAGE_EVENT);
  if (affordable !== Infinity && (!Number.isSafeInteger(affordable) || affordable < 0)) {
    throw new Error('Invalid affordable message count; no pages will be requested');
  }
  return Math.min(requested, affordable);
}

/** Reserve capacity in input order before making any page requests. */
export function allocateChannelBudgets(channels, maxMessagesPerChannel, allowance) {
  if (!Array.isArray(channels) || channels.some(channel => typeof channel !== 'string')) {
    throw new TypeError('channels must be an array of strings');
  }
  if (!Number.isInteger(maxMessagesPerChannel) || maxMessagesPerChannel < 1 || maxMessagesPerChannel > 1000) {
    throw new TypeError('Invalid per-channel message limit');
  }
  if (!Number.isSafeInteger(allowance) || allowance < 0) {
    throw new TypeError('Allowance must be a nonnegative safe integer');
  }
  let remaining = allowance;
  return channels.map(channel => {
    const maxMessages = Math.min(maxMessagesPerChannel, remaining);
    remaining -= maxMessages;
    return { channel, maxMessages };
  });
}

/** Never retry charges: a failed response may follow a successful payment. */
export async function chargeEvent(actor, eventName, count = 1) {
  if (![RUN_EVENT, MESSAGE_EVENT].includes(eventName)) {
    throw new TypeError('Unsupported billing event');
  }
  if (!Number.isSafeInteger(count) || count < 0 || (eventName === RUN_EVENT && count !== 1)) {
    throw new TypeError('Invalid billing event count');
  }
  if (count === 0 || !isPayPerEvent(actor)) {
    return { processedCount: count, chargedCount: 0, stop: false };
  }
  if (typeof actor.charge !== 'function') {
    throw new Error('Pay-per-event charging is unavailable');
  }
  const result = await actor.charge({ eventName, count });
  if (!result || !Number.isSafeInteger(result.chargedCount) || result.chargedCount < 0 ||
      result.chargedCount > count || typeof result.eventChargeLimitReached !== 'boolean') {
    throw new Error('Invalid charging response; stop without retrying the charge');
  }
  return {
    processedCount: result.chargedCount,
    chargedCount: result.chargedCount,
    stop: result.chargedCount < count || result.eventChargeLimitReached,
  };
}
