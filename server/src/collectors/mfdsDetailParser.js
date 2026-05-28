import * as cheerio from 'cheerio';
import { fetchText } from './httpClient.js';
import { isBadTitle, norm, normalizeMfdsUrl, parseAllDates, parseDateAny } from './textUtils.js';

function findRegistrationDate(text) {
  const t = norm(text);
  const patterns = [
    /등록일\s*(20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})/,
    /등록일\s*(20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)/,
    /작성일\s*(20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})/,
    /게시일\s*(20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})/
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return parseDateAny(m[1]);
  }
  const dates = parseAllDates(t);
  return dates[0] || null;
}

function findTitle($, fallbackTitle) {
  const selectors = [
    '.view_tit', '.view-title', '.board-view-title', '.subject', '.tit', '.title',
    'h1', 'h2', 'h3', 'h4'
  ];
  const candidates = [];
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const text = norm($(el).text());
      if (!isBadTitle(text)) candidates.push(text);
    });
  }
  const fallback = norm(fallbackTitle);
  const exact = candidates.find(x => fallback && x.includes(fallback.slice(0, Math.min(20, fallback.length))));
  if (exact) return exact;
  const filtered = candidates.filter(x => !['공지', '공고', '보도자료', '민원인안내서', '공무원지침서'].includes(x));
  return filtered.sort((a, b) => b.length - a.length)[0] || fallback;
}

function findDepartment(text) {
  const t = norm(text);
  const m = t.match(/(?:부서|담당부서)\s*([가-힣A-Za-z0-9·\-\s]{2,40})\s*(?:담당자|전화|조회수|등록일|$)/);
  return m ? norm(m[1]) : '';
}

export async function verifyDetail(candidate) {
  const fallback = { ...candidate, url: normalizeMfdsUrl(candidate.url || '') };
  if (!fallback.url || !/\/view\.do/i.test(fallback.url)) {
    return { row: fallback, verified: false, error: null };
  }

  try {
    const { text, finalUrl } = await fetchText(fallback.url, { timeoutMs: 15000, attempts: 2 });
    const $ = cheerio.load(text);
    const bodyText = norm($('body').text());
    const detailDate = findRegistrationDate(bodyText);
    const title = findTitle($, fallback.title);
    const department = findDepartment(bodyText);
    return {
      row: {
        ...fallback,
        title: title || fallback.title,
        item_date: detailDate || fallback.item_date,
        url: normalizeMfdsUrl(finalUrl || fallback.url, fallback.url),
        department
      },
      verified: true,
      error: null
    };
  } catch (err) {
    return { row: fallback, verified: false, error: `${fallback.board_id || ''} detail ${fallback.url}: ${err?.message || err}` };
  }
}
