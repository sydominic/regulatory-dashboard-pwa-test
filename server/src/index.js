import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { BOARD_ID_LABEL_MAP, MFDS_SOURCES, boardLabel } from './collectors/mfdsSources.js';
import { collectMfdsItems } from './collectors/mfdsCollector.js';
import { collectRssSource } from './collectors/mfdsRssCollector.js';
import { collectHtmlSource } from './collectors/mfdsHtmlCollector.js';
import { addDays, compareDate, norm, normalizeMfdsUrl } from './collectors/textUtils.js';
import { fetchTextRaw } from './collectors/httpClient.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(SERVER_DIR, '..');

function loadRootEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const rows = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const rawLine of rows) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
    console.log(`[env] loaded ${envPath}`);
  } catch (err) {
    console.warn(`[env] failed to load .env: ${err?.message || err}`);
  }
}

loadRootEnv();

const CLIENT_DIST = path.join(ROOT_DIR, 'client', 'dist');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const JSON_STORE_PATH = path.join(DATA_DIR, 'mfds_items_store.json');
const JSON_META_PATH = path.join(DATA_DIR, 'mfds_meta_store.json');

const API_VERSION = 'v1.4-node-render-mfds-network-diagnostic';
const PORT = Number(process.env.PORT || process.env.LOCAL_API_PORT || 8892);
const HOST = process.env.HOST || '0.0.0.0';
const RAW_DATABASE_URL = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '').trim();
const RAW_SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const RAW_SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const ALLOW_LOCAL_POSTGRES = String(process.env.ALLOW_LOCAL_POSTGRES || 'false').toLowerCase() === 'true';
const DATABASE_URL_STATUS = validateDatabaseUrl(RAW_DATABASE_URL, ALLOW_LOCAL_POSTGRES);
const DATABASE_URL = DATABASE_URL_STATUS.usable ? RAW_DATABASE_URL : '';
const SUPABASE_REST_STATUS = validateSupabaseRest(RAW_SUPABASE_URL, RAW_SUPABASE_KEY);
const USE_SUPABASE_REST = !DATABASE_URL && SUPABASE_REST_STATUS.usable;
const AUTO_COLLECT_ON_LOAD = String(process.env.AUTO_COLLECT_ON_LOAD || 'false').toLowerCase() === 'true';

function validateDatabaseUrl(rawUrl, allowLocalPostgres) {
  const value = String(rawUrl || '').trim();
  if (!value) return { usable: false, reason: 'DATABASE_URL not set. local-json or Supabase REST mode will be used.' };
  const lower = value.toLowerCase();
  if (lower.includes('your_password') || lower.includes('xxxxxx') || lower.includes('<') || lower.includes('>')) {
    return { usable: false, reason: 'DATABASE_URL still looks like a placeholder. local-json or Supabase REST mode will be used.' };
  }
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    return { usable: false, reason: 'DATABASE_URL is not a PostgreSQL connection string. local-json or Supabase REST mode will be used.' };
  }
  if (!allowLocalPostgres && (lower.includes('@localhost') || lower.includes('@127.0.0.1') || lower.includes('localhost:5432') || lower.includes('127.0.0.1:5432'))) {
    return { usable: false, reason: 'DATABASE_URL points to local PostgreSQL. Set ALLOW_LOCAL_POSTGRES=true only when local PostgreSQL is actually running; otherwise local-json or Supabase REST mode will be used.' };
  }
  return { usable: true, reason: 'DATABASE_URL accepted.' };
}

function validateSupabaseRest(rawUrl, rawKey) {
  const url = String(rawUrl || '').trim();
  const key = String(rawKey || '').trim();
  if (!url && !key) return { usable: false, reason: 'SUPABASE_URL/SUPABASE_SERVICE_KEY not set.' };
  if (!url || !key) return { usable: false, reason: 'SUPABASE_URL or Supabase key is missing.' };
  if (!/^https:\/\/[^\s]+\.supabase\.co/i.test(url) && !/^https?:\/\//i.test(url)) {
    return { usable: false, reason: 'SUPABASE_URL does not look like a URL.' };
  }
  if (key.length < 20 || key.toLowerCase().includes('your_')) {
    return { usable: false, reason: 'Supabase key looks empty or placeholder.' };
  }
  return { usable: true, reason: 'Supabase REST credentials accepted.' };
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: normalizeDbUrl(DATABASE_URL),
      ssl: shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : false,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

const supabaseRest = USE_SUPABASE_REST
  ? createClient(RAW_SUPABASE_URL, RAW_SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws }
    })
  : null;

function dbMode() {
  if (pool) return 'postgres';
  if (supabaseRest) return 'supabase-rest';
  return 'local-json';
}

let dbReady = false;
let initError = null;

function normalizeDbUrl(url) {
  if (!url) return '';
  return url.startsWith('postgres://') ? url.replace('postgres://', 'postgresql://') : url;
}

function shouldUseSsl(url) {
  return Boolean(url && !url.includes('localhost') && !url.includes('127.0.0.1'));
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(file, fallback) {
  ensureDataDir();
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8');
}

function sha256(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf-8').digest('hex');
}

function stableItemKey(row) {
  const site = norm(row.site || '식약처');
  const boardId = norm(row.board_id || '');
  const url = normalizeMfdsUrl(row.url || '');
  if (boardId && url) return sha256(`${site}|${boardId}|${url}`);
  return sha256(`${site}|${norm(row.category)}|${norm(row.item_date)}|${norm(row.title)}`);
}

function toKstDateString(dateObj) {
  const kst = new Date(dateObj.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getTodayKst() {
  return toKstDateString(new Date());
}

function kstNowString() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace('T', ' ').slice(0, 19);
}

function periodRange(period, startDate, endDate) {
  const today = getTodayKst();
  if (startDate || endDate) {
    const safeEnd = endDate || today;
    return { startDate: startDate || addDays(safeEnd, -7), endDate: safeEnd };
  }
  if (period === 'today') return { startDate: today, endDate: today };
  if (period === 'recent14') return { startDate: addDays(today, -14), endDate: today };
  if (period === 'custom') return { startDate: addDays(today, -7), endDate: today };
  return { startDate: addDays(today, -7), endDate: today };
}

async function initDb() {
  if (dbReady) return;
  if (!pool && !supabaseRest) {
    ensureDataDir();
    if (!fs.existsSync(JSON_STORE_PATH)) writeJsonFile(JSON_STORE_PATH, []);
    if (!fs.existsSync(JSON_META_PATH)) writeJsonFile(JSON_META_PATH, {});
    dbReady = true;
    return;
  }
  if (supabaseRest) {
    try {
      const { error } = await supabaseRest.from('items').select('item_key').limit(1);
      if (error) throw error;
      const { error: metaError } = await supabaseRest.from('meta').select('key').limit(1);
      if (metaError && !String(metaError.message || '').toLowerCase().includes('relation')) throw metaError;
      dbReady = true;
      return;
    } catch (err) {
      initError = err;
      throw err;
    }
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id BIGSERIAL PRIMARY KEY,
        site TEXT NOT NULL,
        category TEXT,
        board_id TEXT,
        item_date TEXT,
        title TEXT NOT NULL,
        url TEXT,
        item_key TEXT UNIQUE,
        collected_at TEXT
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_items_date ON items(item_date)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_items_category_date ON items(category, item_date)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_items_url ON items(url)');
    dbReady = true;
  } catch (err) {
    initError = err;
    throw err;
  }
}

async function dbLoadAll() {
  await initDb();
  if (!pool && !supabaseRest) return sortItemsByDateDesc(readJsonFile(JSON_STORE_PATH, []));
  if (supabaseRest) {
    const all = [];
    const pageSize = 1000;
    for (let from = 0; from < 50000; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error } = await supabaseRest
        .from('items')
        .select('site, category, board_id, item_date, title, url, item_key, collected_at')
        .order('item_date', { ascending: false })
        .order('collected_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return sortItemsByDateDesc(all);
  }
  const result = await pool.query(`
    SELECT site, category, board_id, item_date, title, url, item_key, collected_at
    FROM items
    ORDER BY item_date DESC, id DESC
  `);
  return result.rows || [];
}

function normalizePayloadRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const clean = {
      site: row.site || '식약처',
      category: row.category || boardLabel(row.board_id) || '',
      board_id: row.board_id || '',
      item_date: row.item_date || '',
      title: norm(row.title),
      url: normalizeMfdsUrl(row.url || ''),
      collected_at: kstNowString()
    };
    if (!clean.title || !clean.item_date) continue;
    clean.item_key = stableItemKey(clean);
    const identity = `${clean.item_key}|${clean.url}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(clean);
  }
  return out;
}

async function dbInsertItems(rows) {
  await initDb();
  const payload = normalizePayloadRows(rows);
  if (!payload.length) return { inserted: 0, skipped: 0 };
  let inserted = 0;
  let skipped = 0;

  if (!pool && !supabaseRest) {
    const store = readJsonFile(JSON_STORE_PATH, []);
    const seenKeys = new Set(store.map(x => x.item_key).filter(Boolean));
    const seenUrls = new Set(store.map(x => normalizeMfdsUrl(x.url || '')).filter(Boolean));
    for (const r of payload) {
      if (seenKeys.has(r.item_key) || seenUrls.has(r.url)) {
        skipped += 1;
        continue;
      }
      seenKeys.add(r.item_key);
      if (r.url) seenUrls.add(r.url);
      store.push(r);
      inserted += 1;
    }
    writeJsonFile(JSON_STORE_PATH, store);
    return { inserted, skipped };
  }

  if (supabaseRest) {
    const existingKeys = new Set();
    const existingUrls = new Set();
    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      const keys = chunk.map(x => x.item_key).filter(Boolean);
      const urls = chunk.map(x => x.url).filter(Boolean);
      if (keys.length) {
        const { data, error } = await supabaseRest.from('items').select('item_key,url').in('item_key', keys);
        if (error) throw error;
        for (const row of data || []) existingKeys.add(row.item_key);
      }
      if (urls.length) {
        const { data, error } = await supabaseRest.from('items').select('item_key,url').in('url', urls);
        if (error) throw error;
        for (const row of data || []) existingUrls.add(normalizeMfdsUrl(row.url || ''));
      }
    }
    const toInsert = payload.filter(x => !existingKeys.has(x.item_key) && !existingUrls.has(x.url));
    skipped = payload.length - toInsert.length;
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      const { data, error } = await supabaseRest.from('items').insert(chunk).select('item_key');
      if (error) throw error;
      inserted += (data || []).length;
    }
    return { inserted, skipped };
  }

  const client = await pool.connect();
  try {
    for (const r of payload) {
      const exists = await client.query('SELECT id FROM items WHERE item_key = $1 OR url = $2 LIMIT 1', [r.item_key, r.url]);
      if (exists.rowCount > 0) {
        skipped += 1;
        continue;
      }
      const result = await client.query(
        `INSERT INTO items(site, category, board_id, item_date, title, url, item_key, collected_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (item_key) DO NOTHING
         RETURNING id`,
        [r.site, r.category, r.board_id, r.item_date, r.title, r.url, r.item_key, r.collected_at]
      );
      if (result.rowCount === 1) inserted += 1;
      else skipped += 1;
    }
  } finally {
    client.release();
  }
  return { inserted, skipped };
}

async function dbLastCollected() {
  await initDb();
  if (!pool && !supabaseRest) {
    const store = readJsonFile(JSON_STORE_PATH, []);
    const vals = store.map(x => x.collected_at).filter(Boolean).sort();
    return vals.at(-1) || '-';
  }
  if (supabaseRest) {
    const { data, error } = await supabaseRest.from('items').select('collected_at').not('collected_at', 'is', null).order('collected_at', { ascending: false }).limit(1);
    if (error) throw error;
    return data?.[0]?.collected_at || '-';
  }
  const result = await pool.query('SELECT MAX(collected_at) AS last_collected FROM items');
  return result.rows?.[0]?.last_collected || '-';
}

async function getMeta(key, defaultValue = '') {
  await initDb();
  if (!pool && !supabaseRest) {
    const meta = readJsonFile(JSON_META_PATH, {});
    return meta[key] || defaultValue;
  }
  if (supabaseRest) {
    const { data, error } = await supabaseRest.from('meta').select('value').eq('key', key).maybeSingle();
    if (error) throw error;
    return data?.value || defaultValue;
  }
  const result = await pool.query('SELECT value FROM meta WHERE key = $1', [key]);
  return result.rows?.[0]?.value || defaultValue;
}

async function setMeta(key, value) {
  await initDb();
  if (!pool && !supabaseRest) {
    const meta = readJsonFile(JSON_META_PATH, {});
    meta[key] = value;
    writeJsonFile(JSON_META_PATH, meta);
    return;
  }
  if (supabaseRest) {
    const { error } = await supabaseRest.from('meta').upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
    return;
  }
  await pool.query(
    `INSERT INTO meta(key, value) VALUES($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

function filterItems(items, { startDate, endDate, q = '', category = '전체' }) {
  const keyword = norm(q).toLowerCase();
  return (items || []).filter(item => {
    const d = item.item_date || '';
    if (startDate && compareDate(d, startDate) < 0) return false;
    if (endDate && compareDate(d, endDate) > 0) return false;
    if (category && category !== '전체' && item.category !== category) return false;
    if (keyword) {
      const hay = `${item.title || ''} ${item.category || ''} ${item.board_id || ''}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });
}

function sortItemsByDateDesc(items) {
  return [...(items || [])].sort((a, b) => {
    const dateCmp = String(b.item_date || '').localeCompare(String(a.item_date || ''));
    if (dateCmp) return dateCmp;
    const collectCmp = String(b.collected_at || '').localeCompare(String(a.collected_at || ''));
    if (collectCmp) return collectCmp;
    return String(a.title || '').localeCompare(String(b.title || ''), 'ko');
  });
}

function summarize(items) {
  const today = getTodayKst();
  const recent7 = addDays(today, -7);
  const recent14 = addDays(today, -14);
  const categories = new Map();
  for (const item of items || []) {
    const c = item.category || '기타';
    categories.set(c, (categories.get(c) || 0) + 1);
  }
  const categoryRows = [...categories.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'ko'));
  return {
    total: items.length,
    today: items.filter(x => x.item_date === today).length,
    recent7: items.filter(x => compareDate(x.item_date, recent7) >= 0 && compareDate(x.item_date, today) <= 0).length,
    recent14: items.filter(x => compareDate(x.item_date, recent14) >= 0 && compareDate(x.item_date, today) <= 0).length,
    categoryRows
  };
}

async function collectMfdsToDb(startDate, endDate, collectMode = 'period', options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const progress = (event, payload = {}) => {
    if (onProgress) {
      try { onProgress({ event, ...payload }); } catch { /* ignore */ }
    }
  };
  progress('collect-start', { startDate, endDate, mode: collectMode });
  const collected = await collectMfdsItems({
    startDate,
    endDate,
    mode: collectMode,
    onProgress: p => progress(p?.event || 'progress', p || {})
  });
  progress('db-start', {
    candidates: collected.rows.length,
    checked: collected.checked,
    rssChecked: collected.rssChecked,
    htmlChecked: collected.htmlChecked,
    detailChecked: collected.detailChecked
  });
  const { inserted, skipped } = await dbInsertItems(collected.rows);
  progress('db-done', { inserted, skipped });
  await setMeta('last_collect_range', `${startDate}~${endDate}`);
  await setMeta('last_collect_mode', collectMode);
  await setMeta('last_collect_api_version', API_VERSION);
  const result = {
    inserted,
    skipped,
    checked: collected.checked,
    rssChecked: collected.rssChecked,
    htmlChecked: collected.htmlChecked,
    detailChecked: collected.detailChecked,
    latestItemDate: collected.latestItemDate,
    maxPages: collected.maxPages,
    detailLimit: collected.detailLimit,
    detailLimitReached: Boolean(collected.detailLimitReached),
    warning: (collected.rssChecked + collected.htmlChecked) === 0 || collected.checked === 0,
    boardResults: collected.boardResults,
    errors: collected.errors
  };
  progress('collect-complete', result);
  return result;
}


const collectJobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

function purgeOldJobs() {
  const now = Date.now();
  for (const [id, job] of collectJobs.entries()) {
    if (now - (job.updatedAt || job.createdAt || now) > JOB_TTL_MS) collectJobs.delete(id);
  }
}

function makeJobId() {
  return crypto.randomBytes(8).toString('hex');
}

function compactJob(job) {
  return {
    jobId: job.jobId,
    ok: job.ok,
    status: job.status,
    mode: job.mode,
    startDate: job.startDate,
    endDate: job.endDate,
    createdAt: job.createdAtKst,
    updatedAt: job.updatedAtKst,
    finishedAt: job.finishedAtKst || null,
    progress: job.progress,
    current: job.current,
    logs: job.logs.slice(-30),
    result: job.result,
    error: job.error
  };
}

function pushJobLog(job, message) {
  const line = `${kstNowString()} ${message}`;
  job.logs.push(line);
  if (job.logs.length > 200) job.logs = job.logs.slice(-200);
}

function updateJobFromProgress(job, p = {}) {
  job.updatedAt = Date.now();
  job.updatedAtKst = kstNowString();
  job.current = {
    event: p.event || job.current?.event || '',
    board_id: p.board_id || job.current?.board_id || '',
    category: p.category || job.current?.category || '',
    message: p.message || ''
  };
  for (const key of ['rssChecked', 'htmlChecked', 'detailChecked', 'rows', 'candidates', 'inserted', 'skipped', 'checked']) {
    if (p[key] !== undefined && p[key] !== null) job.progress[key] = Number(p[key] || 0);
  }
  if (p.board) {
    const idx = job.progress.boardResults.findIndex(x => x.board_id === p.board.board_id);
    if (idx >= 0) job.progress.boardResults[idx] = p.board;
    else job.progress.boardResults.push(p.board);
    if (['html-done', 'candidates-done', 'board-done'].includes(p.event)) {
      const h = p.board.htmlDiag || {};
      const r = p.board.rssDiag || {};
      const msg = `[diag ${p.board.board_id}] rssItems=${r.itemTagCount || 0} rssBody=${r.bodyLength || 0} rssTransport=${r.transport || ''} htmlStatus=${h.status || ''} htmlBody=${h.bodyLength || 0} htmlTransport=${h.transport || ''} anchors=${h.anchorTotal || 0} view=${h.viewLinkCandidates || 0} block=${h.textBlockCandidates || 0} candidates=${p.board.candidates || 0} title=${String(h.titleTag || '').slice(0, 60)}`;
      pushJobLog(job, msg);
      console.log(`[collect-job ${job.jobId}] ${msg}`);
    }
  }
  if (p.event) pushJobLog(job, `[${p.event}] ${p.category || p.board_id || ''}`.trim());
}

function createCollectJob({ mode, startDate, endDate }) {
  purgeOldJobs();
  const jobId = makeJobId();
  const nowKst = kstNowString();
  const job = {
    jobId,
    ok: true,
    status: 'queued',
    mode,
    startDate,
    endDate,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdAtKst: nowKst,
    updatedAtKst: nowKst,
    finishedAtKst: null,
    current: { event: 'queued', board_id: '', category: '', message: '수집 대기 중' },
    progress: {
      rssChecked: 0,
      htmlChecked: 0,
      detailChecked: 0,
      rows: 0,
      candidates: 0,
      checked: 0,
      inserted: 0,
      skipped: 0,
      boardResults: []
    },
    result: null,
    error: null,
    logs: []
  };
  pushJobLog(job, `job created mode=${mode} range=${startDate}~${endDate}`);
  collectJobs.set(jobId, job);
  setImmediate(() => runCollectJob(jobId));
  return job;
}

async function runCollectJob(jobId) {
  const job = collectJobs.get(jobId);
  if (!job) return;
  job.status = 'running';
  updateJobFromProgress(job, { event: 'running', message: '수집 시작' });
  console.log(`[collect-job ${jobId}] start mode=${job.mode} range=${job.startDate}~${job.endDate}`);
  try {
    const result = await collectMfdsToDb(job.startDate, job.endDate, job.mode, {
      onProgress: p => updateJobFromProgress(job, p)
    });
    const lastCollected = await dbLastCollected();
    job.result = { ok: true, mode: job.mode, startDate: job.startDate, endDate: job.endDate, ...result, lastCollected };
    job.progress.inserted = Number(result.inserted || 0);
    job.progress.skipped = Number(result.skipped || 0);
    job.progress.checked = Number(result.checked || 0);
    job.status = 'done';
    job.finishedAtKst = kstNowString();
    updateJobFromProgress(job, { event: 'done', inserted: result.inserted, skipped: result.skipped, checked: result.checked, message: '수집 완료' });
    console.log(`[collect-job ${jobId}] done inserted=${result.inserted} skipped=${result.skipped} checked=${result.checked}`);
  } catch (err) {
    job.status = 'failed';
    job.ok = false;
    job.error = String(err?.message || err).slice(0, 1500);
    job.finishedAtKst = kstNowString();
    updateJobFromProgress(job, { event: 'failed', message: job.error });
    console.error(`[collect-job ${jobId}] failed`, err);
  }
}

function rangeFromBody(body = {}) {
  const mode = body.mode === 'fast' ? 'fast' : 'period';
  const today = getTodayKst();
  return {
    mode,
    startDate: body.startDate || addDays(today, -7),
    endDate: body.endDate || today
  };
}

function parseQueryRange(req) {
  const { period = 'recent7', startDate, endDate } = req.query || {};
  return periodRange(period, startDate, endDate);
}

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

app.get('/api/health', (_req, res) => {
  const mode = dbMode();
  res.json({
    ok: true,
    service: 'mfds-regulatory-pwa-api',
    apiVersion: API_VERSION,
    collector: 'async-job-network-aware-rss-html-diagnostic',
    dbMode: mode,
    databaseConfigured: Boolean(DATABASE_URL || USE_SUPABASE_REST),
    databaseUrlStatus: DATABASE_URL_STATUS.reason,
    supabaseRestConfigured: Boolean(USE_SUPABASE_REST),
    supabaseRestStatus: SUPABASE_REST_STATUS.reason,
    dbReady,
    initError: initError ? String(initError?.message || initError).slice(0, 500) : null,
    port: PORT,
    host: HOST,
    today: getTodayKst(),
    sources: MFDS_SOURCES.length
  });
});

app.get('/api/diag/env', (_req, res) => {
  res.json({
    ok: true,
    apiVersion: API_VERSION,
    dbMode: dbMode(),
    databaseConfigured: Boolean(DATABASE_URL || USE_SUPABASE_REST),
    databaseUrlStatus: DATABASE_URL_STATUS.reason,
    supabaseRestConfigured: Boolean(USE_SUPABASE_REST),
    supabaseRestStatus: SUPABASE_REST_STATUS.reason,
    hasSupabaseUrl: Boolean(RAW_SUPABASE_URL),
    hasSupabaseKey: Boolean(RAW_SUPABASE_KEY),
    nodeVersion: process.version,
    today: getTodayKst(),
    sources: MFDS_SOURCES.length
  });
});

app.get('/api/diag/mfds/rss', async (req, res, next) => {
  try {
    const boardId = String(req.query.board || 'm_1060');
    const source = MFDS_SOURCES.find(x => x.board_id === boardId) || MFDS_SOURCES[0];
    const today = getTodayKst();
    const startDate = String(req.query.startDate || addDays(today, -14));
    const endDate = String(req.query.endDate || today);
    const result = await collectRssSource(source, startDate, endDate);
    res.json({ ok: true, board_id: source.board_id, category: source.category, startDate, endDate, stats: result.stats, count: result.rows.length, sample: result.rows.slice(0, 5), errors: result.errors.slice(0, 10) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/diag/mfds/html', async (req, res, next) => {
  try {
    const boardId = String(req.query.board || 'm_1060');
    const source = MFDS_SOURCES.find(x => x.board_id === boardId) || MFDS_SOURCES[0];
    const today = getTodayKst();
    const startDate = String(req.query.startDate || addDays(today, -14));
    const endDate = String(req.query.endDate || today);
    const maxPages = Math.max(1, Math.min(3, Number(req.query.maxPages || 1)));
    const result = await collectHtmlSource(source, startDate, endDate, { maxPages });
    res.json({ ok: true, board_id: source.board_id, category: source.category, startDate, endDate, maxPages, stats: result.stats, count: result.rows.length, sample: result.rows.slice(0, 5), errors: result.errors.slice(0, 10) });
  } catch (err) {
    next(err);
  }
});



function rawSnippet(text, max = 1200) {
  return norm(String(text || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')).slice(0, max);
}

function rssDiagUrls(brdId) {
  if (!brdId) return [];
  return [
    `http://www.mfds.go.kr/www/rss/brd.do?brdId=${encodeURIComponent(brdId)}`,
    `https://www.mfds.go.kr/www/rss/brd.do?brdId=${encodeURIComponent(brdId)}`
  ];
}


function compactFetchDiagnostic(result, label = '') {
  const text = result?.text || '';
  return {
    label,
    ok: Boolean(result?.ok),
    transport: result?.transport || null,
    fallbackFrom: result?.fallbackFrom || null,
    fallbackReason: result?.fallbackReason || null,
    finalUrl: result?.finalUrl || '',
    status: result?.status || null,
    statusText: result?.statusText || '',
    contentType: result?.contentType || '',
    bodyLength: text.length,
    error: result?.error || null,
    titleTag: (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 200),
    anchorCount: (text.match(/<a\b/gi) || []).length,
    viewDoCount: (text.match(/view\.do/gi) || []).length,
    seqCount: (text.match(/seq\s*[=:]/gi) || []).length + (text.match(/[?&]seq=/gi) || []).length,
    dateTokenCount: (text.match(/20\d{2}[.\-/년\s]*\d{1,2}[.\-/월\s]*\d{1,2}/g) || []).length,
    itemTagCount: (text.match(/<item[\s>]/gi) || []).length,
    knownLatestTitleHit: /의료기기\s*비임상시험분야|한약\(생약\)제제|원료마약/.test(text),
    snippet: rawSnippet(text, 700),
    rawStartsWith: String(text || '').trim().slice(0, 160)
  };
}

async function diagFetch(url, options = {}, label = '') {
  const started = Date.now();
  const result = await fetchTextRaw(url, options);
  return { ...compactFetchDiagnostic(result, label), elapsedMs: Date.now() - started };
}

function mfdsUrlVariants(source) {
  const base = source.url;
  const noWww = base.replace('https://www.mfds.go.kr', 'https://mfds.go.kr').replace('http://www.mfds.go.kr', 'http://mfds.go.kr');
  const httpWww = base.replace('https://www.mfds.go.kr', 'http://www.mfds.go.kr');
  return [...new Set([base, `${base}${base.includes('?') ? '&' : '?'}_diag=${Date.now()}`, noWww, httpWww])];
}

app.get('/api/diag/net', async (_req, res, next) => {
  try {
    const tests = [
      { label: 'example-fetch', url: 'https://example.com/', transport: 'fetch', timeoutMs: 15000 },
      { label: 'example-node', url: 'https://example.com/', transport: 'node', timeoutMs: 15000 },
      { label: 'mfds-root-fetch', url: 'https://www.mfds.go.kr/', transport: 'fetch', timeoutMs: 20000, referer: 'https://www.mfds.go.kr/' },
      { label: 'mfds-root-node', url: 'https://www.mfds.go.kr/', transport: 'node', timeoutMs: 20000, referer: 'https://www.mfds.go.kr/' },
      { label: 'mfds-root-node4', url: 'https://www.mfds.go.kr/', transport: 'node4', timeoutMs: 20000, referer: 'https://www.mfds.go.kr/' }
    ];
    const results = [];
    for (const t of tests) {
      results.push(await diagFetch(t.url, t, t.label));
    }
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, apiVersion: API_VERSION, generatedAtKst: kstNowString(), tests: results });
  } catch (err) {
    next(err);
  }
});

app.get('/api/diag/mfds/connect', async (req, res, next) => {
  try {
    const boardId = String(req.query.board || 'm_1060');
    const source = MFDS_SOURCES.find(x => x.board_id === boardId) || MFDS_SOURCES[0];
    const timeoutMs = Math.max(5000, Math.min(60000, Number(req.query.timeout || 30000)));
    const tests = [];
    for (const url of mfdsUrlVariants(source)) {
      tests.push({ label: `fetch ${url}`, url, transport: 'fetch', timeoutMs, referer: 'https://www.mfds.go.kr/' });
      tests.push({ label: `node ${url}`, url, transport: 'node', timeoutMs, referer: 'https://www.mfds.go.kr/' });
      tests.push({ label: `node4 ${url}`, url, transport: 'node4', timeoutMs, referer: 'https://www.mfds.go.kr/' });
    }
    if (source.rssBrdId) {
      for (const url of rssDiagUrls(source.rssBrdId)) {
        tests.push({ label: `rss-fetch ${url}`, url, transport: 'fetch', timeoutMs, accept: 'application/rss+xml,application/xml,text/xml,text/html,*/*;q=0.8', referer: 'https://www.mfds.go.kr/www/rss/list.do' });
        tests.push({ label: `rss-node ${url}`, url, transport: 'node', timeoutMs, accept: 'application/rss+xml,application/xml,text/xml,text/html,*/*;q=0.8', referer: 'https://www.mfds.go.kr/www/rss/list.do' });
        tests.push({ label: `rss-node4 ${url}`, url, transport: 'node4', timeoutMs, accept: 'application/rss+xml,application/xml,text/xml,text/html,*/*;q=0.8', referer: 'https://www.mfds.go.kr/www/rss/list.do' });
      }
    }
    const results = [];
    for (const t of tests) {
      results.push(await diagFetch(t.url, t, t.label));
    }
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, apiVersion: API_VERSION, board_id: source.board_id, category: source.category, timeoutMs, tests: results });
  } catch (err) {
    next(err);
  }
});

app.get('/api/diag/mfds/raw', async (req, res, next) => {
  try {
    const boardId = String(req.query.board || 'm_1060');
    const source = MFDS_SOURCES.find(x => x.board_id === boardId) || MFDS_SOURCES[0];
    const timeoutMs = Math.max(5000, Math.min(60000, Number(req.query.timeout || 30000)));
    const transport = String(req.query.transport || 'both');
    const result = await fetchTextRaw(`${source.url}${source.url.includes('?') ? '&' : '?'}_diag=${Date.now()}`, { timeoutMs, attempts: 1, transport, referer: 'https://www.mfds.go.kr/' });
    const text = result.text || '';
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: result.ok,
      apiVersion: API_VERSION,
      board_id: source.board_id,
      category: source.category,
      url: source.url,
      finalUrl: result.finalUrl,
      status: result.status,
      statusText: result.statusText,
      contentType: result.contentType,
      bodyLength: text.length,
      error: result.error,
      transport: result.transport || null,
      fallbackFrom: result.fallbackFrom || null,
      fallbackReason: result.fallbackReason || null,
      elapsedNote: 'Use /api/diag/mfds/connect for transport-by-transport comparison.',
      titleTag: (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 300),
      anchorCount: (text.match(/<a\b/gi) || []).length,
      viewDoCount: (text.match(/view\.do/gi) || []).length,
      seqCount: (text.match(/seq\s*[=:]/gi) || []).length + (text.match(/[?&]seq=/gi) || []).length,
      dateTokenCount: (text.match(/20\d{2}[.\-/년\s]*\d{1,2}[.\-/월\s]*\d{1,2}/g) || []).length,
      knownLatestTitleHit: /의료기기\s*비임상시험분야|한약\(생약\)제제|원료마약/.test(text),
      textSnippet: rawSnippet(text, 1500),
      htmlSnippet: text.slice(0, 1500)
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/diag/mfds/rss-raw', async (req, res, next) => {
  try {
    const boardId = String(req.query.board || 'm_1060');
    const source = MFDS_SOURCES.find(x => x.board_id === boardId) || MFDS_SOURCES[0];
    const urls = rssDiagUrls(source.rssBrdId);
    const attempts = [];
    for (const url of urls) {
      const timeoutMs = Math.max(5000, Math.min(60000, Number(req.query.timeout || 30000)));
      const transport = String(req.query.transport || 'both');
      const result = await fetchTextRaw(url, { accept: 'application/rss+xml,application/xml,text/xml,text/html,*/*;q=0.8', timeoutMs, transport, attempts: 1, referer: 'https://www.mfds.go.kr/www/rss/list.do' });
      attempts.push({
        url,
        ok: result.ok,
        finalUrl: result.finalUrl,
        status: result.status,
        statusText: result.statusText,
        contentType: result.contentType,
        bodyLength: (result.text || '').length,
        error: result.error,
        transport: result.transport || null,
        fallbackFrom: result.fallbackFrom || null,
        fallbackReason: result.fallbackReason || null,
        itemTagCount: ((result.text || '').match(/<item[\s>]/gi) || []).length,
        channelTagCount: ((result.text || '').match(/<channel[\s>]/gi) || []).length,
        titleTag: ((result.text || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 300),
        snippet: rawSnippet(result.text || '', 1200),
        rawStartsWith: String(result.text || '').trim().slice(0, 120)
      });
    }
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, apiVersion: API_VERSION, board_id: source.board_id, category: source.category, rssBrdId: source.rssBrdId || null, attempts });
  } catch (err) {
    next(err);
  }
});

app.get('/api/options', async (_req, res, next) => {
  try {
    const items = await dbLoadAll();
    const categories = ['전체', ...Object.values(BOARD_ID_LABEL_MAP).filter(c => items.some(x => x.category === c))];
    res.json({ categories, boards: MFDS_SOURCES.map(x => ({ board_id: x.board_id, category: boardLabel(x.board_id), url: x.url })) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/stats', async (req, res, next) => {
  try {
    const range = parseQueryRange(req);
    const all = await dbLoadAll();
    const filtered = sortItemsByDateDesc(filterItems(all, { ...range, q: req.query.q || '', category: req.query.category || '전체' }));
    const recent = filtered.slice(0, 8);
    res.json({ range, stats: summarize(all), filteredStats: summarize(filtered), recent, lastCollected: await dbLastCollected(), totalStored: all.length });
  } catch (err) {
    next(err);
  }
});

app.get('/api/items', async (req, res, next) => {
  try {
    const range = parseQueryRange(req);
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 10)));
    const all = await dbLoadAll();
    const filtered = sortItemsByDateDesc(filterItems(all, { ...range, q: req.query.q || '', category: req.query.category || '전체' }));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const items = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    res.json({ range, total, totalPages, page: currentPage, pageSize, items, lastCollected: await dbLastCollected() });
  } catch (err) {
    next(err);
  }
});

app.post('/api/collect/start', async (req, res, next) => {
  try {
    await initDb();
    const range = rangeFromBody(req.body || {});
    const job = createCollectJob(range);
    res.status(202).json({ ok: true, started: true, ...compactJob(job) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/collect/status/:jobId', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const job = collectJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: '수집 작업을 찾을 수 없습니다.' });
  res.json(compactJob(job));
});

app.get('/api/collect/result/:jobId', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const job = collectJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: '수집 작업을 찾을 수 없습니다.' });
  if (job.status !== 'done') return res.status(job.status === 'failed' ? 500 : 202).json(compactJob(job));
  res.json({ ok: true, ...job.result, job: compactJob(job) });
});

// Backward compatible endpoint: do not run the long collector inside this request.
app.post('/api/collect', async (req, res, next) => {
  try {
    await initDb();
    const range = rangeFromBody(req.body || {});
    const job = createCollectJob(range);
    res.status(202).json({ ok: true, started: true, async: true, ...compactJob(job) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/boards', (_req, res) => {
  res.json({ boards: MFDS_SOURCES.map(x => ({ board_id: x.board_id, category: boardLabel(x.board_id), url: x.url, rssBrdId: x.rssBrdId || null })) });
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '5m' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error('[api error]', err);
  res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 1000) });
});

app.listen(PORT, HOST, async () => {
  console.log(`MFDS Regulatory PWA API listening on http://${HOST}:${PORT}`);
  console.log(`API version: ${API_VERSION}`);
  console.log(`Collector: async-job-network-aware-rss-html-diagnostic`);
  console.log(`Database configured: ${Boolean(DATABASE_URL || USE_SUPABASE_REST)} (${dbMode()})`);
  console.log(`DATABASE_URL status: ${DATABASE_URL_STATUS.reason}`);
  console.log(`Supabase REST status: ${SUPABASE_REST_STATUS.reason}`);
  console.log(`Client dist serving: ${CLIENT_DIST}`);
  try {
    await initDb();
    const startupToday = getTodayKst();
    if (AUTO_COLLECT_ON_LOAD && (await getMeta('last_auto_collect_date', '')) !== startupToday) {
      console.log('Auto collect enabled. Collecting recent 14 days...');
      await collectMfdsToDb(addDays(startupToday, -14), startupToday, 'fast');
      await setMeta('last_auto_collect_date', startupToday);
    }
  } catch (err) {
    console.error('[startup db init warning]', err);
  }
});
