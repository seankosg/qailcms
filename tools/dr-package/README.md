# QAIL CMS 로컬 재해복구(DR) 패키지 생성기

관리자 로컬 PC(Windows / macOS)에서 실행하는 도구입니다. Cloudflare Worker 나 브라우저에서는
GB급 패키지를 만들지 않습니다.

## 실행

- Windows: `QAIL-재해복구-패키지-생성.cmd` 더블클릭
- macOS: `QAIL-재해복구-패키지-생성.command` 더블클릭 (최초 1회 `chmod +x` 필요)

두 런처는 모두 같은 공용 엔진 `run.mjs` → `engine/build.mjs` 를 호출합니다.

## 선행 조건

1. Node.js LTS
2. PostgreSQL **17.x** 의 `pg_dump` / `pg_restore`
   - Windows: https://www.postgresql.org/download/windows/
   - macOS: `brew install postgresql@17`
   - 자동 설치는 하지 않습니다. 못 찾으면 탐색한 경로와 설치 안내를 표시합니다.
   - 다른 위치에 있으면 환경변수 `QAIL_DR_PG_BIN` 에 bin 폴더를 지정하세요.
3. 운영 DB 접속 자격증명 + 백엔드 서버 키(Storage 수집용)

비밀번호와 서버 키는 화면에 표시되지 않고, 명령행 인자·로그·manifest·ZIP 어디에도
기록하지 않습니다.

## 구조

```
tools/dr-package/
├─ run.mjs                    터미널 Wizard (공용 진입점)
├─ QAIL-재해복구-패키지-생성.cmd       Windows 런처
├─ QAIL-재해복구-패키지-생성.command   macOS 런처
└─ engine/
   ├─ build.mjs               생성 순서·검산·영수증 정본
   ├─ pgtools.mjs             pg_dump/pg_restore 17.x 탐색·실행·목차 검증
   ├─ storage.mjs             버킷 재귀 탐색·페이지네이션·다운로드·해시
   ├─ buckets.mjs             대상 7개 버킷 / db-backups 제외 정본
   ├─ zip.mjs                 ZIP64 스트리밍 생성 + 재개봉 검증
   ├─ paths.mjs               경로 이탈·대소문자 충돌 차단
   ├─ hash.mjs                SHA-256
   ├─ redact.mjs              비밀값 마스킹
   ├─ supabase-adapter.mjs    Storage/Admin 접근 어댑터
   └─ readme-template.mjs     패키지 안의 README_KR.md
```

## 패키지 구조

```
QAIL_DR_YYYYMMDD_HHMMSS.zip
└─ QAIL_DR_YYYYMMDD_HHMMSS/
   ├─ README_KR.md
   ├─ backup-manifest.json
   ├─ checksums.sha256
   ├─ database/{qail-full-database.dump, pg-dump.log, database-info.json}
   ├─ auth/users-metadata.json
   ├─ storage/{storage-manifest.json, <bucket>/<원래 상대경로>}
   ├─ system/{release-manifest.json, migrations-manifest.json, environment-template.json}
   └─ verification/backup-report.json
```

## 검산 (ZIP 생성 전·후)

- pg_dump 종료 코드 0, dump 0 byte 아님
- `pg_restore --list` 판독 성공, 목차에 `public` 과 `auth` 존재
- 대상 버킷 7개 전부 조회 완료, 다운로드 실패 0건
- Storage manifest 파일 수·byte 합계 = 실제 값
- 모든 포함 파일 SHA-256 일치
- manifest 선언 파일 수 = ZIP 실제 항목 수
- ZIP 내부 경로 중복·대소문자 충돌 0건
- ZIP 재개봉 후 중앙 디렉터리·필수 파일 확인, ZIP 자체 SHA-256 산출

모든 항목을 통과하기 전에는 `completed` 로 표시하지 않습니다.

## 영수증

작업 폴더의 `run_receipt.json` — 상태(`running`/`completed`/`failed`/`cancelled`),
시작·종료시각, PostgreSQL 버전, dump byte·SHA-256, 버킷별 파일 수·byte,
ZIP 경로·byte·SHA-256, `db-backups` 제외 명시, 오류 원문(마스킹).

## 테스트

```
bunx vitest run tools/dr-package
```
