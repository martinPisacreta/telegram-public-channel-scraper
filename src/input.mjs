import { normalizeChannel } from './channel.mjs';

export function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Input must be an object');
  }
  if (!Array.isArray(input.channels) || input.channels.length < 1 || input.channels.length > 50) {
    throw new Error('channels must contain between 1 and 50 entries');
  }
  const channels = input.channels.map(entry => {
    const value = typeof entry === 'string' ? entry
      : entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.channel : undefined;
    return normalizeChannel(value);
  });
  const maxMessagesPerChannel = input.maxMessagesPerChannel === undefined ? 50 : input.maxMessagesPerChannel;
  if (!Number.isInteger(maxMessagesPerChannel) || maxMessagesPerChannel < 1 || maxMessagesPerChannel > 1000) {
    throw new Error('maxMessagesPerChannel must be an integer from 1 to 1000');
  }
  let sinceDate;
  if (input.sinceDate !== undefined) {
    const value = input.sinceDate;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
      throw new Error('sinceDate must be a valid ISO date');
    }
    const day = value.slice(0, 10);
    const midnight = Date.parse(day + 'T00:00:00Z');
    const timestamp = Date.parse(value);
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day || !Number.isFinite(timestamp)) {
      throw new Error('sinceDate must be a valid ISO date');
    }
    sinceDate = new Date(timestamp).toISOString();
  }
  let keywords = [];
  if (input.keywords !== undefined) {
    if (!Array.isArray(input.keywords) || input.keywords.some(value => typeof value !== 'string' || !value.trim())) {
      throw new Error('keywords must be an array of nonempty strings');
    }
    keywords = [...new Set(input.keywords.map(value => value.trim().toLowerCase()))];
  }
  return { channels, maxMessagesPerChannel, sinceDate, keywords };
}

export function matchesKeywords(text, keywords = []) {
  const normalized = String(text ?? '').toLowerCase();
  return keywords.length === 0 || keywords.some(keyword => normalized.includes(keyword.toLowerCase()));
}
