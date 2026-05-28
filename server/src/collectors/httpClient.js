import { setTimeout as delay } from 'node:timers/promises';

export async function fetchText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 15000);
  const attempts = Number(options.attempts || 2);
  const accept = options.accept || 'text/html,application/xhtml+xml,application/xml,text/xml,application/rss+xml,*/*;q=0.8';
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MFDSDashboardV1/NodeRender',
          'Accept': accept,
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache'
        }
      });
      const buf = await res.arrayBuffer();
      const text = Buffer.from(buf).toString('utf-8');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
      }
      return { text, finalUrl: res.url || url, status: res.status, contentType: res.headers.get('content-type') || '' };
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await delay(attempt * 500);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

export async function politeDelay(ms = 120) {
  await delay(Number(ms || 0));
}
