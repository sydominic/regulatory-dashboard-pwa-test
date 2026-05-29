import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

function buildHeaders(options = {}) {
  const accept = options.accept || 'text/html,application/xhtml+xml,application/xml,text/xml,application/rss+xml,*/*;q=0.8';
  return {
    'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 MFDSDashboard/1.4',
    'Accept': accept,
    'Accept-Language': options.acceptLanguage || 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': options.acceptEncoding || 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    ...(options.referer ? { Referer: options.referer } : {}),
    ...(options.headers || {})
  };
}

function decodeBuffer(buf, contentType = '') {
  const lower = String(contentType || '').toLowerCase();
  // MFDS pages are normally UTF-8 now. If diagnostics later show mojibake, iconv-lite can be added deliberately.
  if (lower.includes('charset=euc-kr') || lower.includes('charset=ks_c_5601')) {
    return Buffer.from(buf).toString('latin1');
  }
  return Buffer.from(buf).toString('utf-8');
}

function decodeBody(buf, headers = {}, contentType = '') {
  const enc = String(headers['content-encoding'] || headers['Content-Encoding'] || '').toLowerCase();
  let decoded = Buffer.from(buf);
  try {
    if (enc.includes('br')) decoded = zlib.brotliDecompressSync(decoded);
    else if (enc.includes('gzip')) decoded = zlib.gunzipSync(decoded);
    else if (enc.includes('deflate')) decoded = zlib.inflateSync(decoded);
  } catch {
    // Keep raw buffer if decompression fails; diagnostics will show body/text issue.
  }
  return decodeBuffer(decoded, contentType);
}

async function onceFetch(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 20000);
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
    const headers = Object.fromEntries(res.headers.entries());
    const text = decodeBody(Buffer.from(buf), headers, contentType);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText || '',
      contentType,
      finalUrl: res.url || url,
      text,
      headers,
      transport: 'fetch'
    };
  } finally {
    clearTimeout(timer);
  }
}

function nodeRequestOnce(url, options = {}, redirectCount = 0) {
  const timeoutMs = Number(options.timeoutMs || 20000);
  const maxBytes = Number(options.maxBytes || 4 * 1024 * 1024);
  const maxRedirects = Number(options.maxRedirects || 5);
  const parsed = new URL(url);
  const lib = parsed.protocol === 'http:' ? http : https;
  const requestOptions = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
    path: `${parsed.pathname || '/'}${parsed.search || ''}`,
    method: 'GET',
    headers: buildHeaders(options),
    family: options.family ? Number(options.family) : undefined
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(requestOptions, res => {
      const status = res.statusCode || 0;
      const headers = res.headers || {};
      const location = headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < maxRedirects) {
        res.resume();
        const nextUrl = new URL(location, url).toString();
        nodeRequestOnce(nextUrl, options, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error(`response too large > ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const contentType = String(headers['content-type'] || '');
        const buf = Buffer.concat(chunks);
        const text = decodeBody(buf, headers, contentType);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || '',
          contentType,
          finalUrl: url,
          text,
          headers,
          transport: options.family ? `node-http-family${options.family}` : 'node-http'
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

async function onceNode(url, options = {}) {
  return await nodeRequestOnce(url, options, 0);
}

async function runSingleTransport(url, options = {}) {
  if (options.transport === 'node') return await onceNode(url, options);
  if (options.transport === 'node4') return await onceNode(url, { ...options, family: 4 });
  if (options.transport === 'fetch') return await onceFetch(url, options);

  // Default: use Node fetch first. If no HTTP response is obtained, fall back to native http/https.
  try {
    return await onceFetch(url, options);
  } catch (err) {
    const fetchError = err?.message || String(err);
    try {
      const nodeResult = await onceNode(url, options);
      return { ...nodeResult, fallbackFrom: 'fetch', fallbackReason: fetchError };
    } catch (nodeErr) {
      // Try IPv4 explicitly once because some public sites behave differently from Render on IPv6.
      try {
        const node4Result = await onceNode(url, { ...options, family: 4 });
        return { ...node4Result, fallbackFrom: 'fetch+node-http', fallbackReason: `${fetchError}; ${nodeErr?.message || nodeErr}` };
      } catch (node4Err) {
        const e = new Error(`${fetchError}; node-http: ${nodeErr?.message || nodeErr}; node-http-family4: ${node4Err?.message || node4Err}`);
        e.cause = node4Err;
        throw e;
      }
    }
  }
}

export async function fetchTextRaw(url, options = {}) {
  const attempts = Number(options.attempts || 1);
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await runSingleTransport(url, options);
      return { ...result, attempt, error: null };
    } catch (err) {
      last = { ok: false, status: null, statusText: '', contentType: '', finalUrl: url, text: '', headers: {}, attempt, transport: options.transport || 'both', error: err?.message || String(err) };
      if (attempt < attempts) await delay(attempt * 750);
    }
  }
  return last || { ok: false, status: null, statusText: '', contentType: '', finalUrl: url, text: '', headers: {}, attempt: attempts, transport: options.transport || 'both', error: 'unknown fetch error' };
}

export async function fetchText(url, options = {}) {
  const attempts = Number(options.attempts || 1);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await fetchTextRaw(url, { ...options, attempts: 1 });
    if (result.ok) {
      return {
        text: result.text,
        finalUrl: result.finalUrl || url,
        status: result.status,
        contentType: result.contentType,
        headers: result.headers,
        transport: result.transport,
        fallbackFrom: result.fallbackFrom || null,
        fallbackReason: result.fallbackReason || null
      };
    }
    lastError = new Error(result.error || `HTTP ${result.status} ${result.statusText || ''}`.trim());
    if (attempt < attempts) await delay(attempt * 750);
  }

  throw lastError;
}

export async function politeDelay(ms = 120) {
  await delay(Number(ms || 0));
}
