MFDS Regulatory PWA v3 - local launcher debug
=============================================

목적
----
이 버전은 로컬 실행 확인을 우선으로 만든 버전입니다.
이전 v2에서 run_local.bat 실행 시 검은창이 깜빡이고 로그가 남지 않는 경우를 막기 위해 실행기를 다시 구성했습니다.

실행 순서
---------
1. 압축파일을 일반 폴더로 완전히 압축 해제합니다.
2. DATABASE_URL을 쓰는 경우 루트 폴더에 .env를 복사합니다.
3. run_local.bat을 실행합니다.
4. 정상 화면: http://127.0.0.1:5292
5. API 상태: http://127.0.0.1:8892/api/health

생성 로그
---------
- run_local.log: 전체 실행 순서, 패키지 설치, 준비 확인 로그
- server.log: Node/Express API 서버 로그
- client.log: React/Vite 클라이언트 로그

v3에서 바꾼 점
--------------
- run_local.bat을 실패해도 닫히지 않는 구조로 변경
- 복잡한 PowerShell 명령을 BAT 내부 반복문에서 분리
- scripts/check-url.ps1, scripts/stop-ports.ps1 추가
- server.log/client.log를 각 실행 창 시작 즉시 생성
- 폴더 구조 검사 추가
- API 버전: v3-local-launcher

최종 방향
---------
이 앱도 제약뉴스 PWA와 동일하게 최종적으로는 아래 구조로 가져갑니다.
- PC 화면
- 모바일 화면
- PWA 설치 가능 구조
- Render Web Service 배포
- 제약뉴스 PWA의 '규제기관 공식자료' 버튼과 연결

현재 v3는 먼저 로컬 실행 안정화 단계입니다.
모바일 전용 조회조건/하단탭/PWA 설치 안내는 로컬 실행이 안정화된 뒤 다음 버전부터 단계적으로 반영합니다.
