import * as cheerio from 'cheerio';
import { fetchText, politeDelay } from './httpClient.js';
import { compareDate, dateInRange, isBadTitle, norm, normalizeMfdsUrl, parseAllDates } from './textUtils.js';

function listUrl(baseUrl, pageNo) {
  const url = new URL(baseUrl);
  if (Number(pageNo) > 1) {
    // MFDS list pages have historically accepted either page or pageIndex depending on board template.
    // Keep page for the current board pages; the fallback parser is intentionally tolerant.
    url.searchParams.set('page', String(pageNo));
  }
  url.searchParams.set('_ts', String(Date.now()).slice(-8));
  return url.toString();
}

function looksLikeFileOrUtility(raw) {
  const value = String(raw || '').toLowerCase();
  return /filedown|download|down\.do|attach|\.pdf(?:\?|$)|\.xlsx?(?:\?|$)|\.hwp(?:x)?(?:\?|$)|\.zip(?:\?|$)|facebook|instagram|naver|twitter|youtube/.test(value);
}

function extractSeq(raw) {
  const value = String(raw || '');
  const direct = value.match(/[?&]seq=(\d+)/i);
  if (direct) return direct[1];
  const named = value.match(/(?:seq|nttId|bbscttSn|articleSeq|boardSeq)["'\s:=,()]+(\d{3,})/i);
  if (named) return named[1];
  const viewCall = value.match(/view\w*\s*\(\s*['"]?(\d{3,})['"]?/i);
  if (viewCall) return viewCall[1];
  return '';
}

function makeViewUrl(source, rawHref, baseUrl, seq = '') {
  const raw = String(rawHref || '').trim();
  if (raw && !raw.startsWith('#') && !raw.toLowerCase().startsWith('javascript:')) {
    return normalizeMfdsUrl(raw, baseUrl);
  }
  if (seq) {
    return normalizeMfdsUrl(`/brd/${source.board_id}/view.do?seq=${encodeURIComponent(seq)}`, source.url);
  }
  return '';
}

function isViewHref(href, boardId) {
  const raw = String(href || '');
  const lower = raw.toLowerCase();
  if (!raw || raw.startsWith('#')) return false;
  if (looksLikeFileOrUtility(raw)) return false;
  // MFDS often renders relative links as view.do?... or ./view.do?...;
  // v1.1 only accepted /view.do and missed those cases.
  if (lower.includes('view.do') && /(?:^|[?&])seq=\d+/i.test(raw)) return true;
  if (raw.includes(`/brd/${boardId}/view.do`)) return true;
  return false;
}

function isLikelyTitle(title) {
  const t = norm(title);
  if (isBadTitle(t)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  if (/^(미리보기|다운받기|첨부파일|새로운게시물)$/.test(t)) return false;
  if (/\.(pdf|hwp|hwpx|xls|xlsx|zip)$/i.test(t)) return false;
  if (t.length < 4 || t.length > 180) return false;
  return true;
}

function contextTextForAnchor($, anchor) {
  const $a = $(anchor);
  const parts = [];
  const containers = [
    $a.closest('li'),
    $a.closest('tr'),
    $a.closest('article'),
    $a.closest('.list_item'),
    $a.closest('.board-list__item'),
    $a.parent(),
    $a.parent().parent(),
    $a.parent().parent().parent()
  ];
  for (const c of containers) {
    const text = norm(c.text());
    if (text && text.length > 5) parts.push(text);
  }
  let cursor = $a.parent();
  for (let i = 0; i < 5 && cursor.length; i += 1) {
    const next = cursor.next();
    const text = norm(next.text());
    if (text) parts.push(text);
    cursor = next;
  }
  return norm([...new Set(parts)].join(' '));
}

function rowKey(row) {
  return `${row.board_id}|${normalizeMfdsUrl(row.url || '')}|${row.item_date || ''}|${norm(row.title)}`;
}

function pageSignature(rows) {
  return rows.slice(0, 12).map(r => `${r.item_date || ''}:${r.title}:${r.url}`).join('|');
}

function addRow(pageRows, seen, row) {
  if (!row || !isLikelyTitle(row.title)) return false;
  const key = rowKey(row);
  if (seen.has(key)) return false;
  seen.add(key);
  pageRows.push(row);
  return true;
}

function pickTitleAnchorFromContainer($, container) {
  const candidates = [];
  $(container).find('a').each((idx, a) => {
    const title = norm($(a).text());
    const href = $(a).attr('href') || '';
    const onclick = $(a).attr('onclick') || '';
    const data = Object.entries($(a).data() || {}).map(([k, v]) => `${k}=${v}`).join(' ');
    const raw = `${href} ${onclick} ${data}`;
    if (!isLikelyTitle(title)) return;
    if (looksLikeFileOrUtility(raw) || looksLikeFileOrUtility(title)) return;
    const score = (String(href).toLowerCase().includes('view.do') ? 20 : 0)
      + (extractSeq(raw) ? 20 : 0)
      + (idx < 2 ? 5 : 0)
      + Math.min(title.length, 60) / 60;
    candidates.push({ a, title, href, onclick, data, score });
  });
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function addRowsFromAnchors($, source, baseUrl, startDate, endDate, pageRows, seen, stats) {
  $('a').each((_, a) => {
    stats.anchorTotal += 1;
    const href = $(a).attr('href') || '';
    const onclick = $(a).attr('onclick') || '';
    const data = Object.entries($(a).data() || {}).map(([k, v]) => `${k}=${v}`).join(' ');
    const seq = extractSeq(`${href} ${onclick} ${data}`);
    if (!isViewHref(href, source.board_id) && !seq) return;
    const title = norm($(a).text());
    if (!isLikelyTitle(title)) return;
    const context = contextTextForAnchor($, a);
    const dates = parseAllDates(context);
    const itemDate = dates.at(-1) || '';
    if (itemDate) stats.dateTokens += 1;
    const normalizedUrl = makeViewUrl(source, href, baseUrl, seq);
    stats.viewLinkCandidates += 1;
    stats.checked += 1;
    const row = {
      site: '식약처',
      category: source.category,
      board_id: source.board_id,
      item_date: itemDate,
      title,
      url: normalizedUrl,
      source_type: 'html-anchor'
    };
    if (itemDate && dateInRange(itemDate, startDate, endDate)) {
      stats.inRange += 1;
      addRow(pageRows, seen, row);
    } else if (!itemDate) {
      stats.noDateCandidates += 1;
      addRow(pageRows, seen, row);
    } else {
      stats.outOfRange += 1;
    }
  });
}

function addRowsFromContainers($, source, baseUrl, startDate, endDate, pageRows, seen, stats) {
  const selectors = 'li, tr, .list_item, .board-list__item, article';
  $(selectors).each((_, container) => {
    const text = norm($(container).text());
    if (!text || text.length < 20) return;
    const dates = parseAllDates(text);
    if (!dates.length) return;
    const itemDate = dates.at(-1);
    const chosen = pickTitleAnchorFromContainer($, container);
    if (!chosen) return;
    const seq = extractSeq(`${chosen.href} ${chosen.onclick} ${chosen.data}`);
    const normalizedUrl = makeViewUrl(source, chosen.href, baseUrl, seq);
    stats.textBlockCandidates += 1;
    stats.checked += 1;
    const row = {
      site: '식약처',
      category: source.category,
      board_id: source.board_id,
      item_date: itemDate,
      title: chosen.title,
      url: normalizedUrl,
      source_type: 'html-block'
    };
    if (itemDate && dateInRange(itemDate, startDate, endDate)) {
      stats.inRange += 1;
      addRow(pageRows, seen, row);
    } else {
      stats.outOfRange += 1;
    }
  });
}

export async function collectHtmlSource(source, startDate, endDate, options = {}) {
  const maxPages = Number(options.maxPages || 3);
  const rows = [];
  const errors = [];
  const stats = {
    source: 'html',
    pages: 0,
    checked: 0,
    inRange: 0,
    outOfRange: 0,
    anchorTotal: 0,
    viewLinkCandidates: 0,
    textBlockCandidates: 0,
    noDateCandidates: 0,
    dateTokens: 0,
    bodyLength: 0,
    lastStatus: null,
    lastContentType: '',
    lastFinalUrl: '',
    bodySnippet: '',
    titleTag: '',
    pageDiagnostics: [],
    sampleTitles: []
  };
  let previousSignature = '';
  let emptyPages = 0;

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const url = listUrl(source.url, pageNo);
    try {
      const fetched = await fetchText(url, { timeoutMs: 15000, attempts: 2 });
      const { text } = fetched;
      stats.pages += 1;
      stats.bodyLength += text.length;
      stats.lastStatus = fetched.status || null;
      stats.lastContentType = fetched.contentType || '';
      const $ = cheerio.load(text);
      const pageBodyText = norm($('body').text());
      stats.lastFinalUrl = fetched.finalUrl || url;
      stats.titleTag = norm($('title').first().text()).slice(0, 200);
      if (!stats.bodySnippet) stats.bodySnippet = pageBodyText.slice(0, 1000);
      const pageDiag = {
        pageNo,
        url,
        finalUrl: fetched.finalUrl || url,
        status: fetched.status || null,
        contentType: fetched.contentType || '',
        bodyLength: text.length,
        titleTag: stats.titleTag,
        bodySnippet: pageBodyText.slice(0, 500),
        anchorTotalBefore: stats.anchorTotal,
        checkedBefore: stats.checked,
        inRangeBefore: stats.inRange,
        sampleTitles: []
      };
      const pageRows = [];
      const seen = new Set();

      addRowsFromAnchors($, source, url, startDate, endDate, pageRows, seen, stats);
      addRowsFromContainers($, source, url, startDate, endDate, pageRows, seen, stats);

      for (const r of pageRows.slice(0, 3)) {
        if (!stats.sampleTitles.includes(r.title)) stats.sampleTitles.push(r.title);
        pageDiag.sampleTitles.push(r.title);
      }
      pageDiag.anchorTotal = stats.anchorTotal - pageDiag.anchorTotalBefore;
      pageDiag.checked = stats.checked - pageDiag.checkedBefore;
      pageDiag.inRange = stats.inRange - pageDiag.inRangeBefore;
      pageDiag.rows = pageRows.length;
      pageDiag.dateTokensTotal = stats.dateTokens;
      stats.pageDiagnostics.push(pageDiag);

      const pageDates = pageRows.map(r => r.item_date).filter(Boolean);
      const signature = pageSignature(pageRows);
      if (pageNo > 1 && signature && signature === previousSignature) break;
      if (signature) previousSignature = signature;

      if (pageRows.length) {
        rows.push(...pageRows);
        emptyPages = 0;
      } else {
        emptyPages += 1;
      }

      if (pageDates.length) {
        const sorted = [...pageDates].sort();
        const maxDate = sorted.at(-1);
        const minDate = sorted[0];
        if (pageNo > 1 && compareDate(maxDate, startDate) < 0) break;
        if (pageNo > 1 && compareDate(minDate, startDate) < 0 && compareDate(maxDate, endDate) <= 0) break;
      }
      if (pageNo > 1 && emptyPages >= 3) break;
      await politeDelay(120);
    } catch (err) {
      errors.push(`${source.board_id} HTML page ${pageNo}: ${err?.message || err}`);
      stats.pageDiagnostics.push({ pageNo, url, error: err?.message || String(err) });
      emptyPages += 1;
      if (emptyPages >= 2) break;
    }
  }

  stats.sampleTitles = stats.sampleTitles.slice(0, 5);
  stats.pageDiagnostics = stats.pageDiagnostics.slice(0, 5);
  return { rows, errors, stats };
}
