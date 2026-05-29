import { setTimeout as delay } from 'node:timers/promises';

function buildHeaders(options = {}) {
  const accept = options.accept || 'text/html,application/xhtml+xml,application/xml,text/xml,application/rss+xml,*/*;q=0.8';
  return {
    'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 MFDSDashboard/1.3',
    'Accept': accept,
    'Accept-Language': options.acceptLanguage || 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    ...(options.referer ? { Referer: options.referer } : {}),
    ...(options.headers || {})
  };
}

function decodeBuffer(buf, contentType = '') {
  const lower = String(contentType || '').toLowerCase();
  // MFDS pages are normally UTF-8 now. Keep fallback simple and deterministic.
  // If later raw diagnostics show mojibake, iconv-lite can be added deliberately.
  if (lower.includes('charset=euc-kr') || lower.includes('charset=ks_c_5601')) {
    return Buffer.from(buf).toString('latin1');
  }
  return Buffer.from(buf).toString('utf-8');
}

async function once(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: buildHeaders(options)
    });
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || '';
    const text = decodeBuffer(buf, contentType);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText || '',
      contentType,
      finalUrl: res.url || url,
      text,
      headers: Object.fromEntries(res.headers.entries())
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTextRaw(url, options = {}) {
  const attempts = Number(options.attempts || 1);
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await once(url, options);
      return { ...result, attempt, error: null };
    } catch (err) {
      last = { ok: false, status: null, statusText: '', contentType: '', finalUrl: url, text: '', headers: {}, attempt, error: err?.message || String(err) };
      if (attempt < attempts) await delay(attempt * 500);
    }
  }
  return last || { ok: false, status: null, statusText: '', contentType: '', finalUrl: url, text: '', headers: {}, attempt: attempts, error: 'unknown fetch error' };
}

export async function fetchText(url, options = {}) {
  const attempts = Number(options.attempts || 1);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await fetchTextRaw(url, { ...options, attempts: 1 });
    if (result.ok) {
      return { text: result.text, finalUrl: result.finalUrl || url, status: result.status, contentType: result.contentType, headers: result.headers };
    }
    lastError = new Error(result.error || `HTTP ${result.status} ${result.statusText || ''}`.trim());
    if (attempt < attempts) await delay(attempt * 500);
  }

  throw lastError;
}

export async function politeDelay(ms = 120) {
  await delay(Number(ms || 0));
}
