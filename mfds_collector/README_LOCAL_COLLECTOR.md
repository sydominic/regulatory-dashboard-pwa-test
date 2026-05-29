# MFDS 로컬 수집기 사용방법

## 구조

Render 대시보드는 Supabase를 조회만 합니다. 식약처 수집은 선생님 PC에서 실행하고, 결과를 Supabase에 저장합니다.

```
로컬 PC 수집기 → Supabase items/meta 저장 → Render 대시보드 조회
```

## 1. 환경변수 설정

`mfds_collector/.env.example`을 복사해서 `mfds_collector/.env`로 이름을 바꾼 뒤 입력합니다.

```
SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=service_role_key
```

`.env` 파일은 GitHub에 올리지 마세요.

## 2. 수동 실행

빠른수집:

```
mfds_collector\run_collect_mfds.bat
```

최근 14일 기간수집:

```
mfds_collector\run_collect_mfds_period_14days.bat
```

## 3. 자동 실행

Windows 작업 스케줄러에서 `mfds_collector\run_collect_mfds_scheduled.bat`를 등록합니다.

권장 주기:
- 매일 08:30
- 필요하면 12:30, 17:30 추가

조건:
- PC가 켜져 있어야 합니다.
- 식약처와 Supabase 접속이 가능해야 합니다.

## 4. 로그

실행 로그:

```
mfds_collector\logs\collect_YYYYMMDDHHMMSS.log
```

최근 요약:

```
mfds_collector\logs\last_collect_summary.json
```

## 5. 대시보드 반영

수집이 완료되면 Render 대시보드는 같은 Supabase를 조회하므로 URL 접속자 모두 최신 저장 데이터를 볼 수 있습니다. 다른 사용자는 Supabase 계정이나 수집기가 필요 없습니다.

## 6. v1.6 제목 오인식 방지

v1.9부터 목록 후보는 상세페이지 검증을 통과해야 저장하며, 최종 제목은 상세페이지 본문 제목을 우선 사용합니다. 또한 `학술토론회`/`학술 토론회`, `전문홍보물`/`전문 홍보물`처럼 공백 차이가 있는 게시판명은 제목으로 저장하지 않습니다.
수집 로그에 아래 문구가 나오면 오인식 후보를 Supabase 저장 전에 제외한 것입니다.

```
품질필터 제외: N건
```

이미 v1.5에서 잘못 들어간 `단일 키워드 검색`, `법, 시행령, 시행규칙` 등의 자료는 아래 파일로 먼저 SELECT 확인 후 삭제하세요.

```
mfds_collector\cleanup_bad_titles.sql
```


## v1.8 수집 대상 보강

안내서/지침(m_218), 학술토론회(m_220), 전문홍보물(m_231)도 수집 대상에 포함됩니다. 한 게시판의 상세검증 제한에 걸려도 다음 게시판 수집은 계속 진행됩니다.


## v1.9 게시판명 오인식 보정

식약처 일부 게시판은 내부 카테고리명과 화면 표시명이 다릅니다.
예: `학술토론회` ↔ `학술 토론회`, `전문홍보물` ↔ `전문 홍보물`.

v1.9는 이러한 공백/기호 차이를 제거한 compact 비교로 게시판명 오인식을 차단합니다.
오염자료가 이미 저장된 경우 Supabase SQL Editor에서 `cleanup_bad_titles.sql`의 SELECT로 확인 후 DELETE 주석을 해제하여 정리하고 재수집하세요.
