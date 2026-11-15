function validateUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://t.me/s/')) {
    throw new Error('Only https://t.me/s/ URLs are allowed');
  }
  const url = new URL(value);
  if (url.origin !== 'https://t.me' || url.username || url.password || !url.pathname.startsWith('/s/')) {
    throw new Error('Only https://t.me/s/ URLs are allowed');
  }
  return url;
}

export async function getText(value) {
  const url = validateUrl(value);
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url.href, {
        redirect: 'manual',
        headers: { Accept: 'text/html' },
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        let target;
        try {
          target = location ? new URL(location, url) : null;
        } catch {
          target = null;
        }
        if (!target || target.origin !== 'https://t.me' || !target.pathname.startsWith('/s/')) {
          throw new Error('Channel is not public or does not exist');
        }
        throw new Error(`Unexpected Telegram redirect: HTTP ${response.status}`);
      }
      const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
      if (retryable && attempt === 0) {
        if (response.body) await response.body.cancel();
        continue;
      }
      if (!response.ok) {
        throw new Error(`Telegram request failed: HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }
}
