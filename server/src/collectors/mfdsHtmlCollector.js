import * as cheerio from 'cheerio';
import { fetchText, politeDelay } from './httpClient.js';
import { compareDate, dateInRange, isBadTitle, norm, normalizeMfdsUrl, parseAllDates } from './textUtils.js';

function listUrl(baseUrl, pageNo) {
  const url = new URL(baseUrl);
  if (Number(pageNo) > 1) url.searchParams.set('page', String(pageNo));
  url.searchParams.set('_ts', String(Date.now()).slice(-8));
  return url.toString();
}

function isViewHref(href, boardId) {
  const raw = String(href || '');
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) return false;
  if (/fileDown|download|\.pdf$|\.xlsx?$|\.hwp$/i.test(raw)) return false;
  if (raw.includes(`/brd/${boardId}/view.do`)) return true;
  if (raw.includes('/view.do') && raw.includes('seq=')) return true;
  return false;
}

function contextTextForAnchor($, anchor) {
  const $a = $(anchor);
  const parts = [];
  const containers = [
    $a.closest('li'),
    $a.closest('tr'),
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
  for (let i = 0; i < 8 && cursor.length; i += 1) {
    const next = cursor.next();
    const text = norm(next.text());
    if (text) parts.push(text);
    cursor = next;
  }
  return norm([...new Set(parts)].join(' '));
}

function pageSignature(rows) {
  return rows.slice(0, 12).map(r => `${r.item_date || ''}:${r.title}:${r.url}`).join('|');
}

export async function collectHtmlSource(source, startDate, endDate, options = {}) {
  const maxPages = Number(options.maxPages || 3);
  const rows = [];
  const errors = [];
  const stats = { source: 'html', pages: 0, checked: 0, inRange: 0 };
  let previousSignature = '';
  let emptyPages = 0;

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const url = listUrl(source.url, pageNo);
    try {
      const { text } = await fetchText(url, { timeoutMs: 15000, attempts: 2 });
      stats.pages += 1;
      const $ = cheerio.load(text);
      const pageRows = [];
      const pageDates = [];

      $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (!isViewHref(href, source.board_id)) return;
        const title = norm($(a).text());
        if (isBadTitle(title)) return;
        const context = contextTextForAnchor($, a);
        const dates = parseAllDates(context);
        const itemDate = dates.at(-1) || '';
        if (itemDate) pageDates.push(itemDate);
        const normalizedUrl = normalizeMfdsUrl(href, url);
        stats.checked += 1;
        const row = {
          site: '식약처',
          category: source.category,
          board_id: source.board_id,
          item_date: itemDate,
          title,
          url: normalizedUrl,
          source_type: 'html'
        };
        if (itemDate && dateInRange(itemDate, startDate, endDate)) {
          stats.inRange += 1;
          pageRows.push(row);
        } else if (!itemDate) {
          // 날짜가 HTML 목록에서 보이지 않는 후보는 상세페이지 검증 단계에서 살릴 수 있도록 유지한다.
          pageRows.push(row);
        }
      });

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
      emptyPages += 1;
      if (emptyPages >= 2) break;
    }
  }

  return { rows, errors, stats };
}
