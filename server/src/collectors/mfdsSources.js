export const BOARD_ID_LABEL_MAP = {
  m_74: '공지',
  m_76: '공고',
  m_99: '보도자료',
  m_203: '법, 시행령, 시행규칙',
  m_211: '고시전문',
  m_212: '훈령전문',
  m_215: '예규전문',
  m_207: '제개정고시등',
  m_209: '입법/행정예고',
  m_1059: '공무원지침서',
  m_1060: '민원인안내서',
  m_218: '안내서/지침',
  m_220: '학술토론회',
  m_231: '전문홍보물'
};

export const MFDS_SOURCES = [
  { board_id: 'm_74', category: '공지', url: 'https://www.mfds.go.kr/brd/m_74/list.do', rssBrdId: 'ntc0003' },
  { board_id: 'm_76', category: '공고', url: 'https://www.mfds.go.kr/brd/m_76/list.do', rssBrdId: 'ntc0004' },
  { board_id: 'm_99', category: '보도자료', url: 'https://www.mfds.go.kr/brd/m_99/list.do', rssBrdId: 'ntc0021' },
  { board_id: 'm_203', category: '법, 시행령, 시행규칙', url: 'https://www.mfds.go.kr/brd/m_203/list.do', rssBrdId: 'data0003' },
  { board_id: 'm_211', category: '고시전문', url: 'https://www.mfds.go.kr/brd/m_211/list.do', rssBrdId: 'data0005' },
  { board_id: 'm_212', category: '훈령전문', url: 'https://www.mfds.go.kr/brd/m_212/list.do', rssBrdId: 'data0006' },
  { board_id: 'm_215', category: '예규전문', url: 'https://www.mfds.go.kr/brd/m_215/list.do', rssBrdId: 'data0007' },
  // 제개정고시등은 RSS 안내의 “최근 개정 법령(data0008)”과 1:1 동일하다고 단정하지 않고 HTML/상세페이지 수집을 주 경로로 둔다.
  { board_id: 'm_207', category: '제개정고시등', url: 'https://www.mfds.go.kr/brd/m_207/list.do', rssBrdId: null },
  { board_id: 'm_209', category: '입법/행정예고', url: 'https://www.mfds.go.kr/brd/m_209/list.do', rssBrdId: 'data0009' },
  { board_id: 'm_1059', category: '공무원지침서', url: 'https://www.mfds.go.kr/brd/m_1059/list.do', rssBrdId: 'data0010' },
  { board_id: 'm_1060', category: '민원인안내서', url: 'https://www.mfds.go.kr/brd/m_1060/list.do', rssBrdId: 'data0011' },
  { board_id: 'm_218', category: '안내서/지침', url: 'https://www.mfds.go.kr/brd/m_218/list.do', rssBrdId: 'data0013' },
  { board_id: 'm_220', category: '학술토론회', url: 'https://www.mfds.go.kr/brd/m_220/list.do', rssBrdId: 'data0014' },
  { board_id: 'm_231', category: '전문홍보물', url: 'https://www.mfds.go.kr/brd/m_231/list.do', rssBrdId: 'data0020' }
];

export function boardLabel(boardId) {
  return BOARD_ID_LABEL_MAP[String(boardId || '').trim()] || String(boardId || '').trim();
}
