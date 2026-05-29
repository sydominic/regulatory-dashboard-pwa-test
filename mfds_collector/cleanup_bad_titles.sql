-- v1.6 잘못 수집된 제목 오인식 자료 정리용 SQL
-- 1) 먼저 아래 SELECT로 삭제 대상 확인
select id, item_date, category, title, url, collected_at
from public.items
where item_date >= '2026-05-23'
  and (
    title in (
      '단일 키워드 검색',
      '통합검색',
      '상세검색',
      '법, 시행령, 시행규칙',
      '법, 시행령, 시험규칙',
      '공지',
      '공고',
      '보도자료',
      '민원인안내서',
      '공무원지침서',
      '제개정고시등',
      '고시전문',
      '훈령전문',
      '예규전문',
      '입법/행정예고',
      '안내서/지침',
      '학술토론회',
      '전문홍보물'
    )
    or title = category
    or lower(coalesce(url, '')) like '%/list.do%'
  )
order by item_date desc, category, title;

-- 2) SELECT 결과가 전부 잘못 수집된 행임을 확인한 뒤에만 아래 DELETE 실행
-- delete from public.items
-- where item_date >= '2026-05-23'
--   and (
--     title in (
--       '단일 키워드 검색',
--       '통합검색',
--       '상세검색',
--       '법, 시행령, 시행규칙',
--       '법, 시행령, 시험규칙',
--       '공지',
--       '공고',
--       '보도자료',
--       '민원인안내서',
--       '공무원지침서',
--       '제개정고시등',
--       '고시전문',
--       '훈령전문',
--       '예규전문',
--       '입법/행정예고',
--       '안내서/지침',
--       '학술토론회',
--       '전문홍보물'
--     )
--     or title = category
--     or lower(coalesce(url, '')) like '%/list.do%'
--   );
