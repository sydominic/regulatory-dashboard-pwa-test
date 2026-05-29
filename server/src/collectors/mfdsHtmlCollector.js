import * as cheerio from 'cheerio';
import { fetchText, politeDelay } from './httpClient.js';
import { compareDate, dateInRange, isBadTitle, norm, normalizeMfdsUrl, parseAllDates } from './textUtils.js';

const BOARD_TITLE_EXACT = new Set([
  '공지', '공고', '보도자료', '법, 시행령, 시행규칙', '법, 시행령, 시험규칙', '고시전문', '훈령전문', '예규전문',
  '제개정고시등', '입법/행정예고', '공무원지침서', '민원인안내서', '안내서/지침', '학술토론회', '전문홍보물'
]);

const UI_TEXT_EXACT = new Set([
  '단일 키워드 검색', '통합검색', '상세검색', '검색어', '검색하기', '검색조건', '검색결과', '전체', '전체보기',
  '첨부파일', '첨부파일 보기', '첨부파일 닫기', '미리보기', '다운받기', '열기', '새로운게시물', '조회수', '등록번호',
  '게시일', '등록일', '담당부서', '번호', '제목', '구분', '분야', '검색도움말', '검색연산자', '검색연산자 사용방법', '일시적으로 서비스를 이용할 수 없습니다.', 'Insert title here'
]);

function listUrl(baseUrl, pageNo) {
  const url = new URL(baseUrl);
  if (Number(pageNo) > 1) {
    url.searchParams.set('page', String(pageNo));
    url.searchParams.set('pageIndex', String(pageNo));
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
  const direct = value.match(/[?&](?:seq|nttId|bbscttSn|articleSeq|boardSeq)=(\d{3,})/i);
  if (direct) return direct[1];
  const named = value.match(/(?:seq|nttId|bbscttSn|articleSeq|boardSeq)["'\s:=,()]+(\d{3,})/i);
  if (named) return named[1];
  const viewCall = value.match(/view\w*\s*\(\s*['"]?(\d{3,})['"]?/i);
  if (viewCall) return viewCall[1];
  return '';
}

function isViewHref(href, boardId) {
  const raw = String(href || '');
  const lower = raw.toLowerCase();
  if (!raw || raw.startsWith('#')) return false;
  if (looksLikeFileOrUtility(raw)) return false;
  if (lower.includes('/brd/') && lower.includes(`/${String(boardId).toLowerCase()}/`) && lower.includes('view.do')) return true;
  if (lower.includes('view.do') && /(?:^|[?&])(?:seq|nttid|bbscttsn|articleseq|boardseq)=\d{3,}/i.test(raw)) return true;
  return false;
}

function makeViewUrl(source, rawHref, baseUrl, seq = '') {
  const raw = String(rawHref || '').trim();
  if (raw && !raw.startsWith('#') && !raw.toLowerCase().startsWith('javascript:') && isViewHref(raw, source.board_id)) {
    return normalizeMfdsUrl(raw, baseUrl);
  }
  if (seq) {
    return normalizeMfdsUrl(`/brd/${source.board_id}/view.do?seq=${encodeURIComponent(seq)}`, source.url);
  }
  return '';
}

function isListOrSearchUrl(url) {
  const value = String(url || '').toLowerCase();
  if (!value) return true;
  if (value.includes('/list.do')) return true;
  if (value.includes('/www/rss/')) return true;
  return false;
}

function isLikelyTitle(title, source = null) {
  const t = norm(title);
  if (isBadTitle(t)) return false;
  if (UI_TEXT_EXACT.has(t)) return false;
  if (BOARD_TITLE_EXACT.has(t)) return false;
  if (source && (t === source.category || t === source.board_id)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  if (/^(미리보기|다운받기|첨부파일|새로운게시물)$/.test(t)) return false;
  if (/\.(pdf|hwp|hwpx|xls|xlsx|zip)$/i.test(t)) return false;
  if (/^(단일|통합|상세)\s*키워드\s*검색$/.test(t)) return false;
  // Do not reject longer legitimate titles just because they contain UI-like words.
  // Exact UI/error labels are rejected by isBadTitle/UI_TEXT_EXACT above.
  if (t.length < 4 || t.length > 180) return false;
  return true;
}

function cleanCellText(raw, source) {
  let t = norm(raw);
  if (!t) return '';
  t = t.replace(/\b20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\b/g, ' ');
  t = t.replace(/20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ');
  t = t.replace(/\b\d{1,8}\b/g, ' ');
  for (const bad of [...UI_TEXT_EXACT, source?.category || '', source?.board_id || '']) {
    if (!bad) continue;
    if (t === bad) return '';
  }
  t = norm(t);
  // Avoid storing a cell that merely equals board/category labels.
  if (BOARD_TITLE_EXACT.has(t) || UI_TEXT_EXACT.has(t)) return '';
  return t;
}

function postSignalFromAnchor($, a, source, baseUrl) {
  const $a = $(a);
  const href = $a.attr('href') || '';
  const onclick = $a.attr('onclick') || '';
  const data = Object.entries($a.data() || {}).map(([k, v]) => `${k}=${v}`).join(' ');
  const raw = `${href} ${onclick} ${data}`;
  if (looksLikeFileOrUtility(raw)) return null;
  const seq = extractSeq(raw);
  if (!isViewHref(href, source.board_id) && !seq) return null;
  const url = makeViewUrl(source, href, baseUrl, seq);
  if (!url || isListOrSearchUrl(url)) return null;
  return { href, onclick, data, raw, seq, url };
}

function findPostSignalInContainer($, container, source, baseUrl) {
  const signals = [];
  $(container).find('a, button').each((idx, el) => {
    const signal = postSignalFromAnchor($, el, source, baseUrl);
    if (!signal) return;
    signals.push({ ...signal, el, idx });
  });
  return signals[0] || null;
}

function pickTitleFromContainer($, container, source, signal = null) {
  // v1.7: never derive title from arbitrary cell/container text.
  // The title must be the actual text of the post-detail anchor. This prevents
  // search/help/error UI text from being stored as a post title.
  const candidates = [];

  if (signal?.el) {
    const aText = norm($(signal.el).text());
    if (isLikelyTitle(aText, source)) candidates.push({ title: aText, score: 100, reason: 'post-anchor' });
  }

  $(container).find('a').each((idx, a) => {
    const signalA = postSignalFromAnchor($, a, source, signal?.url || source.url);
    const title = norm($(a).text());
    if (!signalA || !isLikelyTitle(title, source)) return;
    candidates.push({ title, score: 90 - idx, reason: 'linked-anchor' });
  });

  const unique = [];
  const seen = new Set();
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (seen.has(c.title)) continue;
    seen.add(c.title);
    unique.push(c);
  }
  return unique[0] || null;
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
    $a.closest('.board_list li'),
    $a.parent(),
    $a.parent().parent(),
    $a.parent().parent().parent()
  ];
  for (const c of containers) {
    const text = norm(c.text());
    if (text && text.length > 5) parts.push(text);
  }
  return norm([...new Set(parts)].join(' '));
}

function rowKey(row) {
  return `${row.board_id}|${normalizeMfdsUrl(row.url || '')}|${row.item_date || ''}|${norm(row.title)}`;
}

function pageSignature(rows) {
  return rows.slice(0, 12).map(r => `${r.item_date || ''}:${r.title}:${r.url}`).join('|');
}

function addRow(pageRows, seen, row, source, stats) {
  if (!row || !isLikelyTitle(row.title, source)) {
    stats.rejectedBadTitle += 1;
    return false;
  }
  if (!row.url || isListOrSearchUrl(row.url)) {
    stats.rejectedBadUrl += 1;
    return false;
  }
  const key = rowKey(row);
  if (seen.has(key)) return false;
  seen.add(key);
  pageRows.push(row);
  return true;
}

function addRowsFromAnchors($, source, baseUrl, startDate, endDate, pageRows, seen, stats) {
  $('a').each((_, a) => {
    stats.anchorTotal += 1;
    const signal = postSignalFromAnchor($, a, source, baseUrl);
    if (!signal) return;
    const title = norm($(a).text());
    if (!isLikelyTitle(title, source)) {
      stats.rejectedBadTitle += 1;
      return;
    }
    const context = contextTextForAnchor($, a);
    const dates = parseAllDates(context);
    const itemDate = dates.at(-1) || '';
    if (itemDate) stats.dateTokens += 1;
    stats.viewLinkCandidates += 1;
    stats.checked += 1;
    const row = {
      site: '식약처',
      category: source.category,
      board_id: source.board_id,
      item_date: itemDate,
      title,
      url: signal.url,
      source_type: 'html-anchor'
    };
    if (itemDate && dateInRange(itemDate, startDate, endDate)) {
      stats.inRange += 1;
      addRow(pageRows, seen, row, source, stats);
    } else if (!itemDate) {
      stats.noDateCandidates += 1;
      stats.rejectedBadTitle += 1;
    } else {
      stats.outOfRange += 1;
    }
  });
}

function addRowsFromContainers($, source, baseUrl, startDate, endDate, pageRows, seen, stats) {
  const selectors = 'li, tr, .list_item, .board-list__item, article, .board_list li, .bbs-list li';
  $(selectors).each((_, container) => {
    const text = norm($(container).text());
    if (!text || text.length < 20) return;
    const signal = findPostSignalInContainer($, container, source, baseUrl);
    if (!signal) return; // v1.6: never infer a post from date-only/search blocks.
    const dates = parseAllDates(text);
    const itemDate = dates.at(-1) || '';
    const chosen = pickTitleFromContainer($, container, source, signal);
    if (!chosen) {
      stats.rejectedBadTitle += 1;
      return;
    }
    stats.textBlockCandidates += 1;
    stats.checked += 1;
    const row = {
      site: '식약처',
      category: source.category,
      board_id: source.board_id,
      item_date: itemDate,
      title: chosen.title,
      url: signal.url,
      source_type: `html-block:${chosen.reason}`
    };
    if (itemDate && dateInRange(itemDate, startDate, endDate)) {
      stats.inRange += 1;
      addRow(pageRows, seen, row, source, stats);
    } else if (!itemDate) {
      stats.noDateCandidates += 1;
      stats.rejectedBadTitle += 1;
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
    rejectedBadTitle: 0,
    rejectedBadUrl: 0,
    dateTokens: 0,
    bodyLength: 0,
    lastStatus: null,
    lastContentType: '',
    transport: '',
    fallbackFrom: '',
    fallbackReason: '',
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
      const fetched = await fetchText(url, { timeoutMs: 30000, attempts: 2, referer: 'https://www.mfds.go.kr/' });
      const { text } = fetched;
      stats.pages += 1;
      stats.bodyLength += text.length;
      stats.lastStatus = fetched.status || null;
      stats.lastContentType = fetched.contentType || '';
      stats.transport = fetched.transport || '';
      stats.fallbackFrom = fetched.fallbackFrom || '';
      stats.fallbackReason = fetched.fallbackReason || '';
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
        transport: fetched.transport || '',
        fallbackFrom: fetched.fallbackFrom || '',
        fallbackReason: fetched.fallbackReason || '',
        bodyLength: text.length,
        titleTag: stats.titleTag,
        bodySnippet: pageBodyText.slice(0, 500),
        anchorTotalBefore: stats.anchorTotal,
        checkedBefore: stats.checked,
        inRangeBefore: stats.inRange,
        rejectedBadTitleBefore: stats.rejectedBadTitle,
        rejectedBadUrlBefore: stats.rejectedBadUrl,
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
      pageDiag.rejectedBadTitle = stats.rejectedBadTitle - pageDiag.rejectedBadTitleBefore;
      pageDiag.rejectedBadUrl = stats.rejectedBadUrl - pageDiag.rejectedBadUrlBefore;
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
