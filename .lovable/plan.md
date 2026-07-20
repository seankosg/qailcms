# 백업/저장 기능 최종 실행 계획

## 1. 사용자 최종 선택 요약
- **실행 방식**: D-변형 = **A + 로컬 아카이브 버튼**  
  - 자동 백업: Supabase Edge Functions (`auto-snapshot`) 사용
  - 수동 로컬 저장: TanStack API Route로 `zip` 파일 스트리밍 다운로드
- **개선 사항 채택**: 2번, 9번 제외, 나머지 모두 구현
- **7번 수정**: 파괴적 복원은 **Admin 전용**으로 제한
- **기본 스케줄**: 카타르 도하시간(AST, UTC+3) **23:50 daily**

## 2. 채택 개선 사항 상세

| 번호 | 개선 내용 | 적용 방식 |
|------|-----------|-----------|
| 1 | **SHA-256 해시 검증** | 스냅샷 생성 후 SQL/JSON 데이터에 대해 해시 계산, 메타 테이블에 저장 |
| 3 | **선택적 복원 (Selective Restore)** | 복원 대상 테이블/스키마를 체크박스로 선택 가능 |
| 4 | **RLS/트리거 제어 복원** | 복원 전 `session_replication_role = replica` 또는 트리거 일괄 비활성화 후 복원 완료 시 복구 |
| 5 | **임포트 직전 자동 스냅샷 훅** | ABD/SM/TM/Spare Part 임포트 성공 직전에 자동으로 스냅샷 생성 |
| 6 | **Retention 정책 UI** | Admin 페이지에서 보관 기간(일) 설정 및 수동 정리 버튼 |
| 7 | **파괴적 복원 권한 제한** | `restore-snapshot`은 `d_superuser` 또는 `admin` 역할만 실행 가능 |
| 8 | **백업 실행 로그 테이블** | `backup_run_log`, `restore_run_log`로 성공/실패/소요시간 기록 |
| 10 | **로컬 zip 다운로드 버튼** | `/admin/backup` 페이지에서 "로컬에 아카이브 저장" 버튼 제공 |

## 3. 아키텍처 구성

### 3.1 백업 데이터 흐름

````text
[자동] pg_cron (AST 23:50)
        │
        ▼
[Supabase Edge Function] auto-snapshot
        │
        ├─ SQL dump (pg_dump 스타일 SELECT JSON)
        ├─ Auth users 메타데이터 추출
        ├─ Storage 객체 목록 메타데이터
        ├─ SHA-256 해시 계산
        │
        ▼
[Storage] db-backups/snapshots/{timestamp}.zip
        │
        ▼
[메타 테이블] database_snapshots

[수동] /admin/backup 페이지
        │
        ├─ "지금 백업" 버튼 → auto-snapshot 호출
        ├─ "로컬에 아카이브 저장" 버튼 → TanStack API Route → zip 다운로드
        └─ "복원" 버튼 → restore-snapshot 호출
````

### 3.2 복원 데이터 흐름

````text
[Admin만] 복원 대상 스냅샷 선택
        │
        ▼
[Supabase Edge Function] restore-snapshot
        │
        ├─ RLS 비활성화 / 트리거 비활성화
        ├─ 선택된 테이블만 TRUNCATE + INSERT
        ├─ 해시 재검증
        ├─ RLS/트리거 복구
        │
        ▼
[restore_run_log] 결과 기록
````

## 4. 데이터베이스 마이그레이션

### 4.1 생성 테이블

```sql
CREATE TABLE public.database_snapshots (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamptz default now(),
  size_bytes bigint,
  sha256_hash text,
  tables_included text[],
  storage_path text,
  triggered_by text, -- 'manual' | 'scheduled' | 'pre-import'
  metadata jsonb
);

CREATE TABLE public.backup_run_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text, -- 'running' | 'success' | 'failed'
  snapshot_id uuid references public.database_snapshots(id),
  error_message text,
  duration_ms bigint
);

CREATE TABLE public.restore_run_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text,
  snapshot_id uuid references public.database_snapshots(id),
  restored_tables text[],
  error_message text,
  duration_ms bigint,
  initiated_by uuid references auth.users(id)
);
```

### 4.2 GRANT 및 RLS

- `database_snapshots`, `backup_run_log`, `restore_run_log` → `service_role` ALL
- `authenticated` 에는 SELECT만 허용 (Admin/Super User 정책에 따라)
- `anon` 에는 접근 불가

### 4.3 Storage 버킷

- `db-backups` 버킷 생성 (비공개, 서비스 롤만 쓰기)

## 5. Edge Functions

### 5.1 `auto-snapshot`
- **입력**: `{ schedule?: string, trigger?: string }`
- **동작**:
  1. 백업 대상 테이블 목록에서 JSON 집계
  2. `auth.users` 메타데이터 추출 (민감값 제외)
  3. Storage 객체 목록 메타데이터 추출
  4. zip 압축 및 SHA-256 해시 계산
  5. `db-backups/snapshots/{timestamp}.zip` 업로드
  6. `database_snapshots`에 메타데이터 기록
  7. `backup_run_log`에 성공/실패 기록

### 5.2 `restore-snapshot`
- **입력**: `{ snapshot_id: uuid, tables?: string[], destructive: boolean }`
- **보안**: `Authorization` 헤더에서 토큰 추출 → `public.user_roles` 조회로 admin 확인
- **동작**:
  1. 스냅샷 다운로드 및 해시 검증
  2. 선택된 테이블에 대해 `TRUNCATE` 또는 `INSERT ON CONFLICT` 전략 선택
  3. RLS/트리거 일시 비활성화
  4. 데이터 복원
  5. RLS/트리거 복구
  6. `restore_run_log` 기록

## 6. TanStack API Routes

### 6.1 `/api/public/backup/archive-download` (또는 `/api/backup/archive-download`)
- **메서드**: `POST`
- **입력**: `{ snapshot_id?: uuid }` (미지정 시 최신 스냅샷)
- **출력**: `Response` with `Content-Type: application/zip`, `Content-Disposition: attachment`
- **보안**: `requireSupabaseAuth` middleware + admin 역할 확인
- **동작**: Supabase Storage에서 zip 다운로드 → 클라이언트로 스트리밍

## 7. UI 구성 (`/admin/backup`)

### 7.1 페이지 레이아웃
- 상단: 페이지 제목 + **도움말/Help 버튼** (사용자 가이드 다이얼로그)
- 좌측 카드:
  - **다음 자동 백업**: AST 23:50 다음 실행 시간
  - **마지막 백업**: 상태 + 소요시간 + 해시
  - **보관 개수 / 총 용량**: Retention 기준 초과 항목 표시
- 우측 버튼 그룹:
  - **지금 백업** (모든 역할은 조회만, Admin/Super User만 실행)
  - **로컬에 아카이브 저장** (zip 다운로드)
  - **복원** (Admin만)
- 하단 테이블:
  - 스냅샷 목록 (이름, 생성일, 테이블 수, 크기, 해시, 트리거)
  - 각 행: 다운로드 / 복원 / 삭제

### 7.2 복원 다이얼로그
- 스냅샷 선택
- 복원할 테이블 체크리스트 (기본값: 전체)
- **파괴적 복원** 토글 (Admin만 활성화)
- 경고 메시지: "복원 시 현재 데이터가 덮어쓰여질 수 있습니다."

### 7.3 Retention 설정
- 입력: 보관 일수 (기본 30)
- "오래된 백업 정리" 버튼
- 정리 전 확인 다이얼로그

## 8. 임포트 훅 연동

ABD/SM/TM/Spare Part 임포트 완료 후, 다음 순서로 호출:

```ts
await createPreImportSnapshot({
  trigger: 'pre-import',
  module: 'sm' | 'abd' | 'tm' | 'spare-part',
  import_log_id
});
```

이는 실제 데이터 덮어쓰기 직전에 실행되어 롤백 지점을 보장합니다.

## 9. 스케줄 설정

```sql
SELECT cron.schedule(
  'auto-snapshot-daily',
  '50 20 * * *', -- UTC 20:50 = AST 23:50
  $$
    SELECT net.http_post(
      url := 'https://project--{id}.lovable.app/functions/v1/auto-snapshot',
      headers := '{"Authorization": "Bearer {anon-key}", "Content-Type": "application/json"}'::jsonb,
      body := '{"trigger":"scheduled"}'::jsonb
    ) AS request_id;
  $$
);
```

- 카타르 도하시간(AST) 23:50 = UTC 20:50
- `pg_cron` 및 `pg_net` 확장 필요

## 10. 보안/권한 규칙

| 기능 | 허용 역할 |
|------|-----------|
| 스냅샷 목록 조회 | Admin, Super User, Senior User |
| 수동 백업 실행 | Admin, Super User |
| 로컬 아카이브 다운로드 | Admin, Super User |
| 복원 (비파괴) | Admin, Super User |
| 복원 (파괴적) | Admin only |
| Retention 정리 | Admin only |
| Edge Function 호출 | service_role 또는 인증된 Admin 토큰 |

## 11. 구현 단계

1. **마이그레이션**: `database_snapshots`, `backup_run_log`, `restore_run_log`, `db-backups` 버킷 생성
2. **Edge Functions**: `auto-snapshot`, `restore-snapshot` 구현 및 배포
3. **TanStack Route**: `/api/public/backup/archive-download` 구현
4. **UI**: `/admin/backup` 페이지 구현 및 `/admin` 인덱스 카드 추가
5. **임포트 훅**: 4개 모듈 임포트 성공 후 pre-import 스냅샷 호출 연동
6. **스케줄**: `pg_cron` AST 23:50 작업 등록
7. **테스트**: 해시 검증, 선택적 복원, 권한 분기, 로컬 다운로드 테스트
8. **문서**: 사용자 가이드 (`src/content/backup-user-guide.md`) 및 UI 도움말 버튼 연동

## 12. 제외된 개선 사항

- **2번**: 다중 백업 복사본異地 저장 (이 예산/외부 스토리지 연동 필요)
- **9번**: 백업 암호화 (현재 단계에서 적용하지 않음, 추후 검토)

## 13. 위험 및 완화

| 위험 | 완화 |
|------|------|
| 복원 중 RLS/트리거 미복구 | `restore_run_log` 상태와 복구 스크립트를 별도 저장, 실패 시 알림 |
| 대용량 백업 타임아웃 | 테이블 단위 chunk 처리, Storage multipart upload |
| Auth 복원 시 외래키 충돌 | `auth.users`는 메타데이터만 백업, 실제 계정은 복원하지 않음 |
| 임포트 훅 실패로 인한 데이터 무결성 손상 | 임포트 트랜잭션과 별도로 pre-import 스냅샷 실패 시 임포트 중단 |

---

이 계획은 기존 앱 스택(TanStack Start + Lovable Cloud + Cloudflare Worker)에서 실행 가능하며, SHAW 프로젝트의 백업/복원 패턴을 유지하면서도 현재 프로젝트의 인프라에 맞게 조정한 버전입니다. 승인 시 즉시 구현을 시작합니다.