import test from 'node:test';
import assert from 'node:assert/strict';
import { getText } from '../src/http.mjs';

async function withFetch(fake, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('requests public HTML with manual redirects and an abort signal', async () => {
  await withFetch(async (url, options) => {
    assert.equal(url, 'https://t.me/s/telegram');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Accept, 'text/html');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response('<html>Public messages</html>');
  }, async () => {
    assert.equal(await getText('https://t.me/s/telegram'), '<html>Public messages</html>');
  });
});

test('rejects URLs outside the public view before fetching', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; throw new Error('Unexpected request'); }, async () => {
    for (const url of ['http://t.me/s/telegram', 'https://example.com/s/telegram', 'https://t.me/telegram', 'https://t.me/s/../telegram', 'https://t.me.evil.example/s/telegram']) {
      await assert.rejects(getText(url), /Only https:\/\/t\.me\/s\//);
    }
  });
  assert.equal(calls, 0);
});

test('302 outside the public view reports an unavailable channel without following it', async () => {
  for (const location of ['https://t.me/telegram', '/telegram', 'https://example.com/s/telegram']) {
    let calls = 0;
    await withFetch(async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location } });
    }, async () => {
      await assert.rejects(getText('https://t.me/s/telegram'), /Channel is not public or does not exist/);
    });
    assert.equal(calls, 1);
  }
});

test('redirects within the public view are not followed automatically', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: '/s/telegram?before=441' } });
  }, async () => {
    await assert.rejects(getText('https://t.me/s/telegram'), /Unexpected Telegram redirect/);
  });
  assert.equal(calls, 1);
});

test('429 and server errors receive one retry and release the first body', async () => {
  for (const status of [429, 500, 503, 599]) {
    let calls = 0;
    let cancellations = 0;
    await withFetch(async () => {
      calls++;
      if (calls === 1) return { status, body: { cancel: async () => { cancellations++; } } };
      return new Response('Recovered');
    }, async () => {
      assert.equal(await getText('https://t.me/s/telegram'), 'Recovered');
    });
    assert.equal(calls, 2);
    assert.equal(cancellations, 1);
  }
});

test('persistent retryable failures stop after two attempts', async () => {
  for (const status of [429, 503]) {
    let calls = 0;
    await withFetch(async () => {
      calls++;
      return new Response('Unavailable', { status });
    }, async () => {
      await assert.rejects(getText('https://t.me/s/telegram'), new RegExp('HTTP ' + status));
    });
    assert.equal(calls, 2);
  }
});

test('other HTTP failures and network failures are not retried', async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    await withFetch(async () => {
      calls++;
      return new Response('Rejected', { status });
    }, async () => {
      await assert.rejects(getText('https://t.me/s/telegram'), new RegExp('HTTP ' + status));
    });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await withFetch(async () => { calls++; throw new Error('Network unavailable'); }, async () => {
    await assert.rejects(getText('https://t.me/s/telegram'), /Network unavailable/);
  });
  assert.equal(calls, 1);
});

test('the 30-second timeout aborts a request without retrying', async context => {
  context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    assert.equal(delay, 30000);
    queueMicrotask(callback);
    return 0;
  });
  let calls = 0;
  await withFetch(async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }, async () => {
    await assert.rejects(getText('https://t.me/s/telegram'), error => error.name === 'AbortError');
  });
  assert.equal(calls, 1);
});
