# MFDS Regulatory Update Dashboard v1.5

Render / Node / React / Express 기반 대시보드입니다. Python/Streamlit 파일은 없습니다.

## v1.5 핵심 구조

v1.4 진단 결과 Render 서버에서 `mfds.go.kr` 원문 HTML/RSS 요청이 timeout 되는 것으로 확인되어, 수집과 조회를 분리했습니다.

```
선생님 PC 로컬 수집기 → Supabase 저장/누적 → Render 대시보드 조회
```

다른 사용자는 Render URL만 접속하면 Supabase에 저장된 게시물을 볼 수 있습니다. Supabase 계정이나 로컬 수집기는 필요 없습니다.

## Render 역할

- 대시보드 표시
- Supabase 저장 데이터 조회
- 검색/기간/카테고리 필터
- 통계/목록 표시

Render에서 식약처 직접수집은 수행하지 않습니다.

## 로컬 수집기

`mfds_collector/` 폴더를 사용합니다.

1. `mfds_collector/.env.example`을 `mfds_collector/.env`로 복사
2. `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` 입력
3. `mfds_collector/run_collect_mfds.bat` 실행
4. 수집 완료 후 Render 대시보드에서 조회

자동 실행은 Windows 작업 스케줄러에 `mfds_collector/run_collect_mfds_scheduled.bat`를 등록하세요.

## Render 환경변수

```
NODE_VERSION=20.11.1
SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=service_role_key
AUTO_COLLECT_ON_LOAD=false
ALLOW_LOCAL_POSTGRES=false
```

## 확인

```
/api/health
```

정상 버전값:

```
v1.5-node-render-dashboard-local-collector
```
