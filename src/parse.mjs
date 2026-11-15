const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', times: '×', divide: '÷', shy: '', zwj: '\u200d', zwnj: '\u200c', lrm: '\u200e', rlm: '\u200f' };

export function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (whole, entity) => {
    if (!entity.startsWith('#')) return ENTITIES[entity] ?? whole;
    const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
  });
}

function attributes(tag) {
  const result = Object.create(null);
  const body = tag.replace(/^<\/?[a-z][\w:-]*/i, '').replace(/\/?\s*>$/, '');
  for (const match of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function tags(html) {
  const expression = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  return Array.from(html.matchAll(expression), match => ({
    start: match.index, end: match.index + match[0].length,
    name: (match[1] ?? '').toLowerCase(),
    closing: /^<\//.test(match[0]),
    selfClosing: /\/\s*>$/.test(match[0]),
    attrs: match[1] ? attributes(match[0]) : Object.create(null),
  }));
}

function hasClass(tag, name) {
  return !tag.closing && (tag.attrs.class ?? '').split(/\s+/).includes(name);
}

function innerHtml(html, tokens, opening) {
  let depth = 1;
  for (let index = opening + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.name !== tokens[opening].name) continue;
    if (token.closing) depth--;
    else if (!token.selfClosing) depth++;
    if (depth === 0) return html.slice(tokens[opening].end, token.start);
  }
  return '';
}

function classContent(html, tokens, name) {
  const index = tokens.findIndex(token => hasClass(token, name));
  return index < 0 ? null : innerHtml(html, tokens, index);
}

function plainText(html) {
  const clean = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  let result = '';
  let offset = 0;
  for (const token of tags(clean)) {
    result += clean.slice(offset, token.start);
    if (token.name === 'br' || (token.closing && ['p', 'div', 'li'].includes(token.name))) result += '\n';
    offset = token.end;
  }
  result += clean.slice(offset);
  return decodeEntities(result).replace(/\r\n?/g, '\n').trim();
}

export function parseViews(value) {
  if (value == null) return null;
  const match = plainText(value).replace(/[\s,]/g, '').match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return null;
  const factor = { K: 1000, M: 1000000, B: 1000000000 }[match[2]?.toUpperCase()] ?? 1;
  const count = Math.round(Number(match[1]) * factor);
  return Number.isSafeInteger(count) ? count : null;
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function previousCursor(tokens) {
  const candidates = tokens.filter(token => !token.closing && (token.attrs.rel ?? '').split(/\s+/).includes('prev'));
  candidates.push(...tokens.filter(token => hasClass(token, 'tme_messages_more')));
  for (const token of candidates) {
    try {
      const url = new URL(token.attrs.href, 'https://t.me');
      if (url.origin !== 'https://t.me' || !url.pathname.startsWith('/s/')) continue;
      const raw = url.searchParams.get('before');
      if (!raw || !/^\d+$/.test(raw)) continue;
      const cursor = Number(raw);
      if (Number.isSafeInteger(cursor) && cursor > 0) return cursor;
    } catch { /* Ignore malformed pagination links. */ }
  }
  return null;
}

export function parsePage(html) {
  if (typeof html !== 'string') throw new TypeError('HTML must be a string');
  const pageTokens = tags(html);
  const starts = pageTokens.filter(token => hasClass(token, 'tgme_widget_message_wrap')).map(token => token.start);
  const messages = [];
  const seen = new Set();
  for (let index = 0; index < starts.length; index++) {
    const block = html.slice(starts[index], starts[index + 1] ?? html.length);
    const tokens = tags(block);
    const post = tokens.find(token => !token.closing && token.attrs['data-post'])?.attrs['data-post'];
    const match = post?.match(/^([A-Za-z][A-Za-z0-9_]{3,31})\/(\d+)$/);
    if (!match) continue;
    const channel = match[1];
    const messageId = Number(match[2]);
    const key = channel.toLowerCase() + '/' + messageId;
    if (!Number.isSafeInteger(messageId) || messageId < 1 || seen.has(key)) continue;
    const dateIndex = tokens.findIndex(token => hasClass(token, 'tgme_widget_message_date'));
    const dateHtml = dateIndex < 0 ? '' : innerHtml(block, tokens, dateIndex);
    const dateValue = tags(dateHtml).find(token => token.name === 'time' && !token.closing)?.attrs.datetime;
    const timestamp = dateValue ? Date.parse(dateValue) : NaN;
    if (!Number.isFinite(timestamp)) continue;
    const textHtml = classContent(block, tokens, 'tgme_widget_message_text') ?? '';
    const links = [];
    for (const token of tags(textHtml)) {
      if (token.name !== 'a' || token.closing) continue;
      const url = httpUrl(token.attrs.href);
      if (url && !links.includes(url)) links.push(url);
    }
    const photos = tokens.filter(token => hasClass(token, 'tgme_widget_message_photo_wrap'));
    const photoUrls = [];
    for (const photo of photos) {
      for (const css of (photo.attrs.style ?? '').matchAll(/background-image\s*:\s*url\(\s*(?:'([^']*)'|"([^"]*)"|([^)]*?))\s*\)/gi)) {
        const url = httpUrl((css[1] ?? css[2] ?? css[3]).trim());
        if (url && !photoUrls.includes(url)) photoUrls.push(url);
      }
    }
    const forwarded = classContent(block, tokens, 'tgme_widget_message_forwarded_from_name');
    messages.push({
      channel, messageId, url: 'https://t.me/' + channel + '/' + messageId,
      date: new Date(timestamp).toISOString(), text: plainText(textHtml),
      views: parseViews(classContent(block, tokens, 'tgme_widget_message_views')),
      hasPhoto: photos.length > 0,
      hasVideo: tokens.some(token => hasClass(token, 'tgme_widget_message_video_player')),
      photoUrls, links, forwardedFrom: forwarded == null ? null : plainText(forwarded) || null,
      isReply: tokens.some(token => hasClass(token, 'js-message_reply_text')),
    });
    seen.add(key);
  }
  return { messages, before: previousCursor(pageTokens) };
}
