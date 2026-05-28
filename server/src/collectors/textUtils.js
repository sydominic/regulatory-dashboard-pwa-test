export function norm(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compareDate(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

export function toKstDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const kst = new Date(dateObj.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function parseDateAny(textValue) {
  const dates = parseAllDates(textValue);
  return dates[0] || null;
}

export function parseAllDates(textValue) {
  const t = norm(textValue);
  const found = [];
  const add = (yyyy, mm, dd) => {
    const y = Number(yyyy);
    const m = Number(mm);
    const d = Number(dd);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return;
    if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return;
    found.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  };

  for (const m of t.matchAll(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g)) {
    add(m[1], m[2], m[3]);
  }
  for (const m of t.matchAll(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    add(m[1], m[2], m[3]);
  }

  return [...new Set(found)];
}

export function parseRssDate(textValue) {
  const direct = parseDateAny(textValue);
  if (direct) return direct;
  const raw = norm(textValue);
  if (!raw) return null;
  const parsed = new Date(raw);
  return toKstDateString(parsed);
}

export function dateInRange(dateStr, startDate, endDate) {
  if (!dateStr) return false;
  if (startDate && compareDate(dateStr, startDate) < 0) return false;
  if (endDate && compareDate(dateStr, endDate) > 0) return false;
  return true;
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function normalizeMfdsUrl(rawUrl, baseUrl = 'https://www.mfds.go.kr/') {
  try {
    const url = new URL(String(rawUrl || ''), baseUrl);
    url.hash = '';
    if (url.protocol === 'http:') url.protocol = 'https:';
    const keep = new URLSearchParams();
    const path = url.pathname;
    const seq = url.searchParams.get('seq');
    if (seq) keep.set('seq', seq);
    const page = url.searchParams.get('page');
    if (page && !path.includes('/view.do')) keep.set('page', page);
    for (const key of ['srchWord', 'srchTp', 'srchFr', 'srchTo']) {
      const value = url.searchParams.get(key);
      if (value && !path.includes('/view.do')) keep.set(key, value);
    }
    url.search = keep.toString();
    return url.toString();
  } catch {
    return String(rawUrl || '').trim();
  }
}

export function isBadTitle(title) {
  const t = norm(title);
  if (!t || t.length < 3) return true;
  const badExact = new Set([
    '로그인', '회원가입', '검색', '이전', '다음', '처음', '마지막', '더보기', '목록', '메뉴',
    '본문 바로가기', '전체 메뉴', 'RSS', '누리집 안내지도', '전체메뉴', '바로가기', '펼치기',
    '접기', '다운받기', '미리보기', '열기', '첨부파일 보기', '첨부파일 닫기', 'TOP'
  ]);
  if (badExact.has(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^[‹›<>]+$/.test(t)) return true;
  if (t.length > 260) return true;
  return false;
}

export function itemIdentity(row) {
  const boardId = norm(row?.board_id);
  const url = normalizeMfdsUrl(row?.url || '');
  if (boardId && url) return `${boardId}|${url}`;
  return `${norm(row?.category)}|${norm(row?.item_date)}|${norm(row?.title)}`;
}
