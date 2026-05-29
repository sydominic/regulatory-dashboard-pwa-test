import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { collectMfdsItems } from '../server/src/collectors/mfdsCollector.js';
import { MFDS_SOURCES, boardLabel } from '../server/src/collectors/mfdsSources.js';
import { addDays, isBadTitle, normalizeMfdsUrl, norm } from '../server/src/collectors/textUtils.js';

const __filename = fileURLToPath(import.meta.url);
const COLLECTOR_DIR = path.dirname(__filename);
const ROOT_DIR = path.resolve(COLLECTOR_DIR, '..');
const LOG_DIR = path.join(COLLECTOR_DIR, 'logs');
const COLLECTOR_VERSION = 'v1.6-local-collector-title-guard';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const rows = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
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
}

loadEnvFile(path.join(ROOT_DIR, '.env'));
loadEnvFile(path.join(COLLECTOR_DIR, '.env'));

function kstNowString() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace('T', ' ').slice(0, 19);
}

function todayKst() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
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

function parseArgs(argv) {
  const args = {
    mode: 'fast',
    days: 7,
    startDate: '',
    endDate: '',
    boards: [],
    dryRun: false,
    maxSources: 0
  };
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const [key, ...rest] = raw.slice(2).split('=');
    const value = rest.join('=') || 'true';
    if (key === 'mode') args.mode = value === 'period' ? 'period' : 'fast';
    if (key === 'days') args.days = Math.max(1, Number(value) || 7);
    if (key === 'start') args.startDate = value;
    if (key === 'end') args.endDate = value;
    if (key === 'boards') args.boards = value.split(',').map(x => x.trim()).filter(Boolean);
    if (key === 'dry-run') args.dryRun = value !== 'false';
    if (key === 'max-sources') args.maxSources = Math.max(0, Number(value) || 0);
  }
  const endDate = args.endDate || todayKst();
  const startDate = args.startDate || addDays(endDate, -args.days);
  return { ...args, startDate, endDate };
}

function makeLogger() {
  ensureDir(LOG_DIR);
  const stamp = kstNowString().replace(/[-: ]/g, '').slice(0, 14);
  const logPath = path.join(LOG_DIR, `collect_${stamp}.log`);
  const summaryPath = path.join(LOG_DIR, 'last_collect_summary.json');
  function line(message) {
    const text = `[${kstNowString()}] ${message}`;
    console.log(text);
    fs.appendFileSync(logPath, text + '\n', 'utf-8');
  }
  return { line, logPath, summaryPath };
}

function requireSupabaseEnv() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('SUPABASE_URL이 없거나 URL 형식이 아닙니다. mfds_collector/.env 또는 루트 .env에 입력하세요.');
  if (key.length < 20) throw new Error('SUPABASE_SERVICE_KEY가 없거나 너무 짧습니다. service_role key를 입력하세요.');
  return { url, key };
}

async function supabaseFetch({ url, key }, table, query = '', options = {}) {
  const endpoint = `${url}/rest/v1/${table}${query}`;
  const res = await fetch(endpoint, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`Supabase ${table} HTTP ${res.status}: ${detail}`);
  }
  return { body, res };
}

async function loadExisting(supa, logger) {
  const keys = new Set();
  const urls = new Set();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { body } = await supabaseFetch(supa, 'items', '?select=item_key,url', {
      method: 'GET',
      prefer: 'return=representation',
      headers: { Range: `${offset}-${offset + pageSize - 1}` }
    });
    const rows = Array.isArray(body) ? body : [];
    for (const row of rows) {
      if (row.item_key) keys.add(row.item_key);
      if (row.url) urls.add(normalizeMfdsUrl(row.url));
    }
    if (rows.length < pageSize) break;
  }
  logger.line(`기존 DB 중복키 로드: item_key ${keys.size}개, url ${urls.size}개`);
  return { keys, urls };
}

function isInvalidCollectedTitle(row) {
  const title = norm(row.title);
  const category = norm(row.category || boardLabel(row.board_id));
  const url = normalizeMfdsUrl(row.url || '');
  if (!title || isBadTitle(title)) return true;
  if (category && title === category) return true;
  if (/^(단일|통합|상세)\s*키워드\s*검색$/.test(title)) return true;
  if (['법, 시행령, 시행규칙', '법, 시행령, 시험규칙'].includes(title)) return true;
  if (!url || /\/list\.do/i.test(url)) return true;
  return false;
}

function normalizeForInsert(rows, logger = null) {
  const now = kstNowString();
  let rejected = 0;
  const normalizedRows = rows.map(row => {
    const normalizedUrl = normalizeMfdsUrl(row.url || '');
    const normalized = {
      site: row.site || '식약처',
      category: row.category || boardLabel(row.board_id),
      board_id: row.board_id || '',
      item_date: row.item_date || '',
      title: norm(row.title || ''),
      url: normalizedUrl,
      collected_at: now
    };
    normalized.item_key = stableItemKey(normalized);
    return normalized;
  }).filter(row => {
    const ok = row.title && row.item_date && row.item_key && !isInvalidCollectedTitle(row);
    if (!ok) rejected += 1;
    return ok;
  });
  if (logger && rejected) logger.line(`품질필터 제외: ${rejected}건 (검색 UI/게시판명/목록URL 등 제목 오인식 방지)`);
  return normalizedRows;
}

async function insertRows(supa, rows, logger) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { body } = await supabaseFetch(supa, 'items', '', {
      method: 'POST',
      body: JSON.stringify(chunk),
      prefer: 'return=representation'
    });
    inserted += Array.isArray(body) ? body.length : chunk.length;
    logger.line(`Supabase 저장 진행: ${Math.min(i + 200, rows.length)}/${rows.length}`);
  }
  return inserted;
}

async function upsertMeta(supa, key, value) {
  await supabaseFetch(supa, 'meta', '?on_conflict=key', {
    method: 'POST',
    body: JSON.stringify([{ key, value: String(value ?? '') }]),
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

async function main() {
  const logger = makeLogger();
  const args = parseArgs(process.argv);
  const supa = requireSupabaseEnv();
  const started = Date.now();
  const selectedSources = args.boards.length
    ? MFDS_SOURCES.filter(src => args.boards.includes(src.board_id))
    : MFDS_SOURCES;
  const sources = args.maxSources > 0 ? selectedSources.slice(0, args.maxSources) : selectedSources;

  logger.line(`MFDS local collector ${COLLECTOR_VERSION}`);
  logger.line(`대상기간: ${args.startDate}~${args.endDate}, mode=${args.mode}, boards=${sources.map(s => s.board_id).join(',')}`);
  logger.line(`Supabase: ${supa.url}`);

  const collected = await collectMfdsItems({
    startDate: args.startDate,
    endDate: args.endDate,
    mode: args.mode,
    sources,
    onProgress: event => {
      if (event.event === 'board-start') logger.line(`게시판 시작: ${event.category} (${event.board_id})`);
      if (event.event === 'board-done') {
        const b = event.board || {};
        logger.line(`게시판 완료: ${event.category} / RSS ${b.rssChecked || 0}, HTML ${b.htmlChecked || 0}, 상세 ${b.detailChecked || 0}, 후보 ${b.candidates || 0}, 최종 ${b.count || 0}${b.errors?.length ? ` / 오류: ${b.errors[0]}` : ''}`);
      }
    }
  });

  const normalized = normalizeForInsert(collected.rows, logger);
  logger.line(`수집 후보: raw ${collected.rows.length}건, 저장 가능 ${normalized.length}건, latest=${collected.latestItemDate || '-'}`);

  let inserted = 0;
  let skipped = 0;
  if (args.dryRun) {
    logger.line('dry-run=true: Supabase 저장은 생략합니다.');
  } else {
    const existing = await loadExisting(supa, logger);
    const toInsert = [];
    for (const row of normalized) {
      const u = normalizeMfdsUrl(row.url || '');
      if (existing.keys.has(row.item_key) || (u && existing.urls.has(u))) {
        skipped += 1;
        continue;
      }
      existing.keys.add(row.item_key);
      if (u) existing.urls.add(u);
      toInsert.push(row);
    }
    logger.line(`신규 저장 대상: ${toInsert.length}건, 중복 제외: ${skipped}건`);
    if (toInsert.length) inserted = await insertRows(supa, toInsert, logger);
    await upsertMeta(supa, 'last_collect_api_version', COLLECTOR_VERSION);
    await upsertMeta(supa, 'last_collect_source', 'local-windows-collector');
    await upsertMeta(supa, 'last_collect_result', `inserted=${inserted}, skipped=${skipped}, checked=${normalized.length}, range=${args.startDate}~${args.endDate}`);
  }

  const summary = {
    ok: true,
    version: COLLECTOR_VERSION,
    startedAtKst: new Date(started + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    finishedAtKst: kstNowString(),
    elapsedSec: Math.round((Date.now() - started) / 1000),
    mode: args.mode,
    startDate: args.startDate,
    endDate: args.endDate,
    checked: normalized.length,
    inserted,
    skipped,
    latestItemDate: collected.latestItemDate || null,
    rssChecked: collected.rssChecked,
    htmlChecked: collected.htmlChecked,
    detailChecked: collected.detailChecked,
    errors: collected.errors || [],
    boardResults: collected.boardResults || []
  };
  fs.writeFileSync(logger.summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  logger.line(`완료: 신규 ${inserted}건, 중복 ${skipped}건, 확인 ${normalized.length}건, 소요 ${summary.elapsedSec}초`);
  logger.line(`요약파일: ${logger.summaryPath}`);
}

main().catch(err => {
  ensureDir(LOG_DIR);
  const message = `[${kstNowString()}] 수집 실패: ${err?.stack || err?.message || err}\n`;
  console.error(message);
  fs.appendFileSync(path.join(LOG_DIR, 'collect_error.log'), message, 'utf-8');
  process.exitCode = 1;
});
