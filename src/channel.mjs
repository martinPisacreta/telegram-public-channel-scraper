import { parsePage } from './parse.mjs';
import { getText as defaultGetText } from './http.mjs';

export function normalizeChannel(value) {
  if (typeof value !== 'string') throw new TypeError('Channel must be a string');
  let channel = value.trim();
  if (/^https:\/\//i.test(channel)) {
    let url;
    try { url = new URL(channel); } catch { throw new Error('Invalid channel'); }
    if (url.origin !== 'https://t.me' || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid channel');
    }
    const match = url.pathname.match(/^\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})\/?$/);
    if (!match) throw new Error('Invalid channel');
    channel = match[1];
  } else if (channel.startsWith('@')) {
    channel = channel.slice(1);
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(channel)) throw new Error('Invalid channel');
  return channel.toLowerCase();
}

function newestFirst(left, right) {
  return Date.parse(right.date) - Date.parse(left.date) || right.messageId - left.messageId;
}

export async function fetchChannel(value, { maxMessages = 50, sinceDate, getText = defaultGetText } = {}) {
  const channel = normalizeChannel(value);
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 1000) {
    throw new Error('maxMessages must be an integer from 1 to 1000');
  }
  if (typeof getText !== 'function') throw new TypeError('getText must be a function');
  let since = null;
  if (sinceDate !== undefined) {
    if (typeof sinceDate !== 'string' || !Number.isFinite(Date.parse(sinceDate))) {
      throw new Error('sinceDate must be a valid ISO date');
    }
    since = Date.parse(sinceDate);
  }

  const messages = new Map();
  const cursors = new Set();
  let before = null;
  let pages = 0;
  try {
    while (pages < 50) {
      if (pages > 0) await new Promise(resolve => setTimeout(resolve, 500));
      const url = 'https://t.me/s/' + channel + (before === null ? '' : '?before=' + before);
      pages++;
      const page = parsePage(await getText(url));
      const candidates = page.messages
        .filter(message => message.channel.toLowerCase() === channel)
        .sort(newestFirst);
      let passedSinceDate = false;
      for (const message of candidates) {
        if (since !== null && Date.parse(message.date) < since) {
          passedSinceDate = true;
          continue;
        }
        if (!messages.has(message.messageId)) messages.set(message.messageId, message);
      }
      if (messages.size >= maxMessages || passedSinceDate || page.before === null) break;
      if (cursors.has(page.before) || (before !== null && page.before >= before)) break;
      cursors.add(page.before);
      before = page.before;
    }
  } catch (cause) {
    const error = new Error(cause instanceof Error ? cause.message : String(cause), { cause });
    error.channel = channel;
    error.pages = pages;
    throw error;
  }
  return {
    channel,
    messages: [...messages.values()].sort(newestFirst).slice(0, maxMessages),
    pages,
  };
}
