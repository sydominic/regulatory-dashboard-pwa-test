-- v1.7 잘못 수집된 제목 오인식 자료 정리용 SQL
-- 목적: 검색 UI/오류 페이지 문구가 제목으로 저장된 행 삭제 후 v1.7 로컬수집기로 재수집

-- 1) 백업: 먼저 1회 실행
create table if not exists items_backup_before_v17_cleanup as
select *
from items;

-- 2) 삭제 대상 확인
select
  id,
  item_date,
  category,
  board_id,
  title,
  url,
  collected_at
from items
where item_date >= '2026-05-23'
  and (
    title in (
      '단일 키워드 검색',
      '검색도움말',
      '검색연산자',
      '검색연산자 사용방법',
      '자동완성',
      '상세 검색 옵션',
      '일시적으로 서비스를 이용할 수 없습니다.',
      '서비스를 이용할 수 없습니다.',
      'Insert title here',
      '법, 시행령, 시행규칙',
      '법, 시행령, 시험규칙',
      '공지',
      '공고',
      '보도자료',
      '공무원지침서',
      '민원인안내서',
      '제개정고시등',
      '안내서/지침',
      '학술토론회',
      '전문홍보물'
    )
    or title = category
    or title like '%검색도움말%'
    or title like '%검색연산자%'
    or title like '%일시적으로 서비스를 이용할 수 없습니다%'
    or url is null
    or url = ''
    or lower(url) like '%/list.do%'
  )
order by item_date desc, category, title;

-- 3) 위 SELECT 결과가 전부 잘못 수집된 행임을 확인한 뒤 아래 DELETE 실행
-- delete from items
-- where item_date >= '2026-05-23'
--   and (
--     title in (
--       '단일 키워드 검색',
--       '검색도움말',
--       '검색연산자',
--       '검색연산자 사용방법',
--       '자동완성',
--       '상세 검색 옵션',
--       '일시적으로 서비스를 이용할 수 없습니다.',
--       '서비스를 이용할 수 없습니다.',
--       'Insert title here',
--       '법, 시행령, 시행규칙',
--       '법, 시행령, 시험규칙',
--       '공지',
--       '공고',
--       '보도자료',
--       '공무원지침서',
--       '민원인안내서',
--       '제개정고시등',
--       '안내서/지침',
--       '학술토론회',
--       '전문홍보물'
--     )
--     or title = category
--     or title like '%검색도움말%'
--     or title like '%검색연산자%'
--     or title like '%일시적으로 서비스를 이용할 수 없습니다%'
--     or url is null
--     or url = ''
--     or lower(url) like '%/list.do%'
--   );

-- 4) 삭제 후 확인
select item_date, category, title, url
from items
where item_date >= '2026-05-23'
order by item_date desc, category, title;
