import { MFDS_SOURCES, boardLabel } from './mfdsSources.js';
import { collectRssSource } from './mfdsRssCollector.js';
import { collectHtmlSource } from './mfdsHtmlCollector.js';
import { verifyDetail } from './mfdsDetailParser.js';
import { dateInRange, itemIdentity, normalizeMfdsUrl } from './textUtils.js';
import { politeDelay } from './httpClient.js';

function maxPagesFor(mode, startDate, endDate) {
  const days = Math.max(1, Math.floor((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1);
  if (mode === 'fast') return 3;
  if (days <= 14) return 5;
  if (days <= 31) return 10;
  if (days <= 90) return 20;
  if (days <= 180) return 35;
  return 60;
}

function mergeCandidates(candidates) {
  const map = new Map();
  for (const row of candidates) {
    const normalized = { ...row, url: normalizeMfdsUrl(row.url || '') };
    const key = itemIdentity(normalized);
    if (!key.trim()) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, normalized);
      continue;
    }
    map.set(key, {
      ...existing,
      ...normalized,
      // 상세일자가 없는 HTML 후보보다 RSS 또는 상세에서 잡은 날짜를 우선한다.
      item_date: normalized.item_date || existing.item_date,
      title: normalized.title || existing.title,
      source_type: existing.source_type === normalized.source_type ? existing.source_type : `${existing.source_type || ''}+${normalized.source_type || ''}`.replace(/^\+|\+$/g, '')
    });
  }
  return [...map.values()];
}

function buildEmptyBoardResult(source) {
  return {
    board_id: source.board_id,
    category: boardLabel(source.board_id),
    rssChecked: 0,
    rssInRange: 0,
    htmlChecked: 0,
    htmlInRange: 0,
    htmlPages: 0,
    detailChecked: 0,
    detailErrors: 0,
    candidates: 0,
    count: 0,
    latestDate: null,
    errors: []
  };
}

export async function collectMfdsItems({ startDate, endDate, mode = 'period', sources = MFDS_SOURCES } = {}) {
  const maxPages = maxPagesFor(mode, startDate, endDate);
  const rows = [];
  const errors = [];
  const boardResults = [];
  let rssChecked = 0;
  let htmlChecked = 0;
  let detailChecked = 0;
  let latestItemDate = null;

  for (const source of sources) {
    const board = buildEmptyBoardResult(source);
    const boardCandidates = [];

    const rss = await collectRssSource(source, startDate, endDate);
    boardCandidates.push(...rss.rows);
    board.rssChecked = rss.stats.checked || 0;
    board.rssInRange = rss.stats.inRange || 0;
    board.errors.push(...rss.errors.slice(0, 3));
    rssChecked += board.rssChecked;

    // 빠른수집도 HTML 1~3페이지를 보조로 본다. 기간수집은 HTML을 주 경로로 더 깊게 본다.
    const html = await collectHtmlSource(source, startDate, endDate, { maxPages });
    boardCandidates.push(...html.rows);
    board.htmlChecked = html.stats.checked || 0;
    board.htmlInRange = html.stats.inRange || 0;
    board.htmlPages = html.stats.pages || 0;
    board.errors.push(...html.errors.slice(0, 3));
    htmlChecked += board.htmlChecked;

    const uniqueCandidates = mergeCandidates(boardCandidates);
    board.candidates = uniqueCandidates.length;

    for (const candidate of uniqueCandidates) {
      // 후보 날짜가 기간 밖이면 상세페이지 검증 전에는 제외하되, 날짜가 없는 후보는 상세 검증한다.
      if (candidate.item_date && !dateInRange(candidate.item_date, startDate, endDate)) continue;
      const verified = await verifyDetail(candidate);
      detailChecked += 1;
      board.detailChecked += 1;
      if (verified.error) {
        board.detailErrors += 1;
        board.errors.push(verified.error);
      }
      const row = verified.row;
      if (!row.item_date || !dateInRange(row.item_date, startDate, endDate)) continue;
      rows.push({
        site: '식약처',
        category: row.category || source.category,
        board_id: row.board_id || source.board_id,
        item_date: row.item_date,
        title: row.title,
        url: normalizeMfdsUrl(row.url || source.url, source.url)
      });
      board.count += 1;
      if (!board.latestDate || row.item_date > board.latestDate) board.latestDate = row.item_date;
      if (!latestItemDate || row.item_date > latestItemDate) latestItemDate = row.item_date;
      await politeDelay(mode === 'fast' ? 60 : 80);
    }

    board.errors = [...new Set(board.errors)].slice(0, 6);
    errors.push(...board.errors);
    boardResults.push(board);
    await politeDelay(120);
  }

  const deduped = mergeCandidates(rows);
  return {
    rows: deduped,
    boardResults,
    errors: [...new Set(errors)].slice(0, 30),
    rssChecked,
    htmlChecked,
    detailChecked,
    checked: deduped.length,
    latestItemDate,
    maxPages
  };
}
