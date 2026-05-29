import { MFDS_SOURCES, boardLabel } from './mfdsSources.js';
import { collectRssSource } from './mfdsRssCollector.js';
import { collectHtmlSource } from './mfdsHtmlCollector.js';
import { verifyDetail } from './mfdsDetailParser.js';
import { dateInRange, itemIdentity, normalizeMfdsUrl } from './textUtils.js';
import { politeDelay } from './httpClient.js';

function maxPagesFor(mode, startDate, endDate) {
  const days = Math.max(1, Math.floor((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1);
  if (mode === 'fast') return 1;
  if (days <= 14) return 3;
  if (days <= 31) return 5;
  if (days <= 90) return 8;
  if (days <= 180) return 12;
  return 20;
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
    rssDiag: {},
    htmlDiag: {},
    errors: []
  };
}

export async function collectMfdsItems({ startDate, endDate, mode = 'period', sources = MFDS_SOURCES, onProgress = null } = {}) {
  const maxPages = maxPagesFor(mode, startDate, endDate);
  const detailLimit = mode === 'fast' ? 45 : 140;
  let detailLimitReached = false;
  const progress = (event, payload = {}) => {
    if (typeof onProgress === 'function') {
      try { onProgress({ event, ...payload }); } catch { /* ignore progress callback errors */ }
    }
  };
  const rows = [];
  const errors = [];
  const boardResults = [];
  let rssChecked = 0;
  let htmlChecked = 0;
  let detailChecked = 0;
  let latestItemDate = null;

  for (const source of sources) {
    const board = buildEmptyBoardResult(source);
    progress('board-start', { board_id: source.board_id, category: boardLabel(source.board_id), rssChecked, htmlChecked, detailChecked, rows: rows.length });
    const boardCandidates = [];

    progress('rss-start', { board_id: source.board_id, category: boardLabel(source.board_id) });
    const rss = await collectRssSource(source, startDate, endDate);
    boardCandidates.push(...rss.rows);
    board.rssChecked = rss.stats.checked || 0;
    board.rssInRange = rss.stats.inRange || 0;
    board.rssDiag = {
      itemTagCount: rss.stats.itemTagCount || 0,
      bodyLength: rss.stats.bodyLength || 0,
      contentType: rss.stats.lastContentType || '',
      feedUrl: rss.stats.feedUrl || null,
      triedUrls: rss.stats.triedUrls || [],
      snippet: rss.stats.snippet || '',
      rawStartsWith: rss.stats.rawStartsWith || '',
      transport: rss.stats.transport || '',
      fallbackFrom: rss.stats.fallbackFrom || '',
      fallbackReason: rss.stats.fallbackReason || ''
    };
    board.errors.push(...rss.errors.slice(0, 3));
    rssChecked += board.rssChecked;
    progress('rss-done', { board_id: source.board_id, category: boardLabel(source.board_id), board, rssChecked, htmlChecked, detailChecked, rows: rows.length });

    // 빠른수집도 HTML 1~3페이지를 보조로 본다. 기간수집은 HTML을 주 경로로 더 깊게 본다.
    progress('html-start', { board_id: source.board_id, category: boardLabel(source.board_id), maxPages });
    const html = await collectHtmlSource(source, startDate, endDate, { maxPages });
    boardCandidates.push(...html.rows);
    board.htmlChecked = html.stats.checked || 0;
    board.htmlInRange = html.stats.inRange || 0;
    board.htmlPages = html.stats.pages || 0;
    board.htmlDiag = {
      bodyLength: html.stats.bodyLength || 0,
      anchorTotal: html.stats.anchorTotal || 0,
      viewLinkCandidates: html.stats.viewLinkCandidates || 0,
      textBlockCandidates: html.stats.textBlockCandidates || 0,
      noDateCandidates: html.stats.noDateCandidates || 0,
      rejectedBadTitle: html.stats.rejectedBadTitle || 0,
      rejectedBadUrl: html.stats.rejectedBadUrl || 0,
      dateTokens: html.stats.dateTokens || 0,
      outOfRange: html.stats.outOfRange || 0,
      contentType: html.stats.lastContentType || '',
      status: html.stats.lastStatus || null,
      finalUrl: html.stats.lastFinalUrl || '',
      transport: html.stats.transport || '',
      fallbackFrom: html.stats.fallbackFrom || '',
      fallbackReason: html.stats.fallbackReason || '',
      titleTag: html.stats.titleTag || '',
      bodySnippet: html.stats.bodySnippet || '',
      pageDiagnostics: html.stats.pageDiagnostics || [],
      sampleTitles: html.stats.sampleTitles || []
    };
    board.errors.push(...html.errors.slice(0, 3));
    htmlChecked += board.htmlChecked;
    progress('html-done', { board_id: source.board_id, category: boardLabel(source.board_id), board, rssChecked, htmlChecked, detailChecked, rows: rows.length });

    const uniqueCandidates = mergeCandidates(boardCandidates);
    board.candidates = uniqueCandidates.length;
    progress('candidates-done', { board_id: source.board_id, category: boardLabel(source.board_id), board, candidates: board.candidates, rssChecked, htmlChecked, detailChecked, rows: rows.length });

    for (const candidate of uniqueCandidates) {
      // 후보 날짜가 기간 밖이면 상세페이지 검증 전에는 제외하되, 날짜가 없는 후보는 상세 검증한다.
      if (candidate.item_date && !dateInRange(candidate.item_date, startDate, endDate)) continue;
      if (detailChecked >= detailLimit) {
        detailLimitReached = true;
        board.errors.push(`detail limit reached (${detailLimit})`);
        break;
      }
      const verified = await verifyDetail(candidate);
      detailChecked += 1;
      board.detailChecked += 1;
      if (detailChecked % 10 === 0) progress('detail-progress', { board_id: source.board_id, category: boardLabel(source.board_id), rssChecked, htmlChecked, detailChecked, rows: rows.length });
      if (verified.error) {
        board.detailErrors += 1;
        board.errors.push(verified.error);
      }
      if (!verified.verified) continue; // v1.7: do not save fallback/list title when detail verification fails.
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
    progress('board-done', { board_id: source.board_id, category: boardLabel(source.board_id), board, rssChecked, htmlChecked, detailChecked, rows: rows.length });
    if (detailLimitReached) {
      progress('detail-limit-stop', { detailLimit, rssChecked, htmlChecked, detailChecked, rows: rows.length });
      break;
    }
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
    maxPages,
    detailLimit,
    detailLimitReached
  };
}
