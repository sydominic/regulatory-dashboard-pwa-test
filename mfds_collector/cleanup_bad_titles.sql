-- v1.9 잘못 수집된 제목 오인식 자료 정리용 SQL
-- 목적: 검색 UI/게시판명/오류화면 문구가 제목으로 저장된 행 삭제 후 v1.9 로컬수집기로 재수집
-- 주의: 정상 제목 안에 '검색', '도움말', '서비스'가 일부 포함된 경우를 지우지 않도록 기본은 완전일치 위주입니다.

-- 1) 백업: 먼저 1회 실행
create table if not exists items_backup_before_v19_cleanup as
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
      '안내서 지침',
      '학술토론회',
      '학술 토론회',
      '전문홍보물',
      '전문 홍보물'
    )
    or title = category
    or regexp_replace(title, '[[:space:]·ㆍ・,，.。:：;；/\\|_\-–—()\[\]{}<>《》「」『』"''‘’“”]+', '', 'g')
       = regexp_replace(category, '[[:space:]·ㆍ・,，.。:：;；/\\|_\-–—()\[\]{}<>《》「」『』"''‘’“”]+', '', 'g')
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
--       '안내서 지침',
--       '학술토론회',
--       '학술 토론회',
--       '전문홍보물',
--       '전문 홍보물'
--     )
--     or title = category
--     or regexp_replace(title, '[[:space:]·ㆍ・,，.。:：;；/\\|_\-–—()\[\]{}<>《》「」『』"''‘’“”]+', '', 'g')
--        = regexp_replace(category, '[[:space:]·ㆍ・,，.。:：;；/\\|_\-–—()\[\]{}<>《》「」『』"''‘’“”]+', '', 'g')
--     or url is null
--     or url = ''
--     or lower(url) like '%/list.do%'
--   );

-- 4) 삭제 후 확인
select item_date, category, title, url
from items
where item_date >= '2026-05-23'
order by item_date desc, category, title;
