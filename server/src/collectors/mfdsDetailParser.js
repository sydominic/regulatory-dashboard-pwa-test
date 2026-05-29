import * as cheerio from 'cheerio';
import { fetchText } from './httpClient.js';
import { isBadTitle, norm, normalizeMfdsUrl, parseAllDates, parseDateAny } from './textUtils.js';

const META_LABEL_RE = /^(등록번호|분야|고시일|등록일|조회수|첨부파일|부서|담당자|전화|현재 페이지의 내용|만족도|이전글|다음글)$/;
const CATEGORY_TITLES = new Set([
  '공지', '공고', '보도자료', '법, 시행령, 시행규칙', '법, 시행령, 시험규칙', '고시전문', '훈령전문', '예규전문',
  '제개정고시등', '입법/행정예고', '공무원지침서', '민원인안내서', '안내서/지침', '학술토론회', '전문홍보물'
]);

function isErrorLikePage(bodyText) {
  const t = norm(bodyText);
  if (!t) return true;

  // Do not reject a legitimate official post merely because its title/body contains an error-like phrase.
  // Treat it as an error page only when the page is short/dominantly an error screen and lacks MFDS post metadata.
  const hasPostMeta = /(등록일|게시일|작성일|조회수|담당부서|등록번호|첨부파일)/.test(t);
  const hasDate = /20\d{2}[.\-/년\s]+\d{1,2}[.\-/월\s]+\d{1,2}/.test(t);
  const shortOrBare = t.length < 900;
  const errorPhrase = /(일시적으로 서비스를 이용할 수 없습니다|서비스를 이용할 수 없습니다|요청하신 페이지를 찾을 수 없습니다|오류가 발생했습니다|Insert title here)/.test(t);

  return Boolean(errorPhrase && shortOrBare && !hasPostMeta && !hasDate);
}

function splitMeaningfulLines(text) {
  return String(text || '')
    .split(/\r?\n+/)
    .map(x => norm(x))
    .filter(Boolean);
}

function cleanTitleCandidate(raw) {
  let t = norm(raw);
  t = t.replace(/^제목\s*/g, '');
  t = t.replace(/\s*새로운게시물$/g, '');
  t = t.replace(/\s*첨부파일.*$/g, '');
  return norm(t);
}

function isValidPostTitle(title, candidate = {}) {
  const t = cleanTitleCandidate(title);
  if (isBadTitle(t)) return false;
  if (CATEGORY_TITLES.has(t)) return false;
  if (candidate?.category && t === norm(candidate.category)) return false;
  if (/\.(pdf|hwp|hwpx|xls|xlsx|zip)$/i.test(t)) return false;
  if (/^(등록번호|조회수|담당자|전화|부서|고시일|등록일)\b/.test(t)) return false;
  // Exact UI/error labels are rejected by isBadTitle/CATEGORY_TITLES; longer legitimate titles are allowed.
  if (t.length < 4 || t.length > 220) return false;
  return true;
}

function findRegistrationDate(text) {
  const t = norm(text);
  const patterns = [
    /등록일\s*(20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})/,
    /등록일\s*(20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)/,
    /작성일\s*(20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})/,
    /게시일\s*(20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})/,
    /고시일\s*(20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})/
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return parseDateAny(m[1]);
  }
  const dates = parseAllDates(t);
  return dates[0] || null;
}

function titleFromDetailLines(bodyText, candidate = {}) {
  const lines = splitMeaningfulLines(bodyText);
  const category = norm(candidate.category || '');
  const categoryIndexes = [];
  for (let i = 0; i < lines.length; i += 1) {
    if ((category && lines[i] === category) || CATEGORY_TITLES.has(lines[i])) categoryIndexes.push(i);
  }

  // MFDS detail pages usually render as: [category] -> [title] -> 등록번호/분야/등록일...
  for (const idx of categoryIndexes.reverse()) {
    for (let j = idx + 1; j < Math.min(lines.length, idx + 12); j += 1) {
      const line = cleanTitleCandidate(lines[j]);
      if (META_LABEL_RE.test(line)) break;
      if (/^(등록번호|분야|고시일|등록일|조회수)\b/.test(line)) break;
      if (isValidPostTitle(line, candidate)) return line;
    }
  }

  // If the list title was good and appears in the detail body, keep it as a safe fallback.
  const fallback = cleanTitleCandidate(candidate.title || '');
  if (isValidPostTitle(fallback, candidate) && bodyText.includes(fallback.slice(0, Math.min(20, fallback.length)))) {
    return fallback;
  }

  return '';
}

function findTitle($, bodyText, candidate = {}) {
  const fromLines = titleFromDetailLines(bodyText, candidate);
  if (fromLines) return fromLines;

  const selectors = [
    '.view_tit', '.view-title', '.board-view-title', '.subject', '.tit', '.title',
    '.view-cont-title', '.bbs-view-title', '.board_view h4', '.board_view h3',
    'main h1', 'main h2', 'main h3', 'main h4', '#content h1', '#content h2', '#content h3', '#content h4'
  ];
  const candidates = [];
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const text = cleanTitleCandidate($(el).text());
      if (isValidPostTitle(text, candidate)) candidates.push(text);
    });
  }
  return [...new Set(candidates)].sort((a, b) => b.length - a.length)[0] || '';
}

function findDepartment(text) {
  const t = norm(text);
  const m = t.match(/(?:부서|담당부서)\s*([가-힣A-Za-z0-9·\-\s]{2,40})\s*(?:담당자|전화|조회수|등록일|$)/);
  return m ? norm(m[1]) : '';
}

export async function verifyDetail(candidate) {
  const fallback = { ...candidate, url: normalizeMfdsUrl(candidate.url || '') };
  if (!fallback.url || !/\/view\.do/i.test(fallback.url)) {
    return { row: fallback, verified: false, error: `${fallback.board_id || ''} detail skipped: not a view URL` };
  }

  try {
    const { text, finalUrl } = await fetchText(fallback.url, { timeoutMs: 25000, attempts: 1, referer: 'https://www.mfds.go.kr/' });
    const $ = cheerio.load(text);
    const rawBodyText = $('body').text();
    const bodyText = norm(rawBodyText);
    if (isErrorLikePage(bodyText)) {
      return { row: fallback, verified: false, error: `${fallback.board_id || ''} detail error page: ${fallback.url}` };
    }
    const detailDate = findRegistrationDate(bodyText);
    const title = findTitle($, rawBodyText, fallback);
    if (!isValidPostTitle(title, fallback)) {
      return { row: fallback, verified: false, error: `${fallback.board_id || ''} detail title invalid: ${fallback.url}` };
    }
    const department = findDepartment(bodyText);
    return {
      row: {
        ...fallback,
        title,
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
