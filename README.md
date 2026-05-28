# MFDS Regulatory PWA V1.1

Node/React/Vite + Express + Render version. Python/Streamlit 파일은 사용하지 않습니다.

## Structure

```text
client/
server/
server/src/collectors/
package.json
render.yaml
render-build.sh
supabase_schema.sql
```

## V1.1 핵심 변경

- `/api/collect` 장시간 동기 실행을 폐기하고 비동기 Job 방식으로 변경했습니다.
- 빠른수집/기간수집 클릭 시 `/api/collect/start`가 즉시 `jobId`를 반환합니다.
- 화면은 `/api/collect/status/:jobId`를 2초마다 조회하여 진행상태를 표시합니다.
- RSS 확인 수, HTML 확인 수, 상세검증 수, 후보 수, 신규/중복 수를 단계별로 표시합니다.
- Render 502 HTML을 식약처 수집 실패처럼 표시하지 않도록 분리했습니다.
- 빠른수집은 HTML 1페이지, 상세검증 최대 45건으로 제한하여 Render 장시간 대기를 줄였습니다.
- 기간수집은 기간에 따라 HTML 페이지 수와 상세검증 수를 제한합니다.
- 진단 API를 추가했습니다.

## Health check

```text
/api/health
```

Expected API version:

```text
v1.2-node-render-mfds-parser-diagnostic
```

## Diagnostic API

```text
/api/diag/env
/api/diag/mfds/rss?board=m_1060
/api/diag/mfds/html?board=m_1060&maxPages=1
```

## Collect API

```text
POST /api/collect/start
GET  /api/collect/status/:jobId
GET  /api/collect/result/:jobId
```

`POST /api/collect`는 호환용으로 남겨두되, 내부적으로는 작업을 시작하고 즉시 반환합니다.
