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
    '접기', '다운받기', '미리보기', '열기', '첨부파일 보기', '첨부파일 닫기', 'TOP',
    // v1.7: MFDS list/search/help/error UI text must never be stored as a post title.
    '단일 키워드 검색', '통합검색', '상세검색', '검색어', '검색하기', '검색조건', '검색결과',
    '검색도움말', '검색연산자', '검색연산자 사용방법', '자동완성', '내가찾은검색어',
    '상세 검색 옵션', '상세 검색 닫기', '검색 상세검색', '검색 범위 설정', '검색 결과 기간 설정',
    '일시적으로 서비스를 이용할 수 없습니다.', '서비스를 이용할 수 없습니다.', 'Insert title here',
    '전체', '전체보기', '게시판', '게시글', '새로운게시물', '첨부파일', '등록번호', '조회수',
    '공지', '공고', '보도자료', '민원인안내서', '공무원지침서', '제개정고시등',
    '법, 시행령, 시행규칙', '법, 시행령, 시험규칙', '고시전문', '훈령전문', '예규전문',
    '입법/행정예고', '안내서/지침', '학술토론회', '전문홍보물', '현재 페이지의 내용에 만족하십니까?'
  ]);
  if (badExact.has(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^[‹›<>]+$/.test(t)) return true;
  if (/^(분야|구분|제목|게시일|등록일|담당부서|처리상태|번호|고시일|전화|담당자|부서)$/.test(t)) return true;
  if (/^(단일|통합|상세)\s*키워드\s*검색$/.test(t)) return true;
  // Do not block merely because a normal official title contains words like 검색/도움말/서비스.
  // Block exact UI/error labels only via badExact above.
  if (/^페이지\s*\d+/.test(t)) return true;
  if (/^\d+\s*건$/.test(t)) return true;
  if (/^(이전글|다음글)$/.test(t)) return true;
  if (t.length > 260) return true;
  return false;
}

export function itemIdentity(row) {
  const boardId = norm(row?.board_id);
  const url = normalizeMfdsUrl(row?.url || '');
  if (boardId && url) return `${boardId}|${url}`;
  return `${norm(row?.category)}|${norm(row?.item_date)}|${norm(row?.title)}`;
}
