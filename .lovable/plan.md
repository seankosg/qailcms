## 사전 스냅샷 대용량 임포트 대응 계획

### 목표
큰 임포트에서 사전 스냅샷이 지연/타임아웃되거나 실패하는 문제를 해결. 사전 스냅샷을 **비동기(fire-and-forget) + 청크 분할 업로드**로 전환.

### 원인 요약
- `createPreImportSnapshot`이 단일 요청에서 전체 테이블 페이지네이션 → 전량 메모리 → `JSON.stringify` → Storage 업로드 → SHA-256을 순차 처리 → Worker CPU/응답 한도 초과.
- `Hasher`가 모든 청크를 메모리 보관 후 합쳐서 해시 → 메모리 상한 접근.
- 클라이언트 `takePreImportSnapshotWithFeedback`은 15초 soft-timeout 후에도 서버 함수는 계속 실행 → Worker 종료로 반쪽 스냅샷 잔존 가능.

### 변경 사항

#### 1) 서버: 스냅샷 잡 큐 도입 (fire-and-forget)
- 신규 서버 함수 `enqueuePreImportSnapshot` (`src/lib/backup/backup.functions.ts`)
  - 인증 후 `backup_run_log`에 `status='queued'` 행 즉시 insert 하고 `{ run_id }` 반환. 실제 스냅샷 생성은 수행하지 않음.
  - 응답은 1초 이내로 반환되어 임포트 UX가 블록되지 않음.
- 신규 서버 라우트 `POST /api/public/backup/run-queued-snapshot` (`src/routes/api/public/backup/run-queued-snapshot.ts`)
  - `apikey` 헤더로 인증(기존 auto-snapshot 라우트와 동일 패턴).
  - 큐에서 `queued` 상태 1건을 `running`으로 원자적 전이(RPC `claim_backup_run`) 후 실제 스냅샷 생성.
- 신규 DB 함수 `claim_backup_run(_run_id)` — 동시 실행 방지용 잠금 전이.
- pg_cron: 매 분 `net.http_post`로 위 라우트를 호출해 큐 소진(기존 `db-backups` 스케줄 옆에 추가).
- `enqueuePreImportSnapshot`은 동일한 라우트를 `fetch(..., { keepalive: false })`로 즉시 1회 트리거(불발되어도 pg_cron이 뒤이어 처리).

#### 2) 서버: 스냅샷 코어 청크 분할 (`src/lib/backup/backup-core.server.ts`)
- `readAllRows` → 스트리밍 `for-await` 이터레이터 `iterRowsPaged(table, pageSize=1000)`로 교체.
- 각 테이블을 **파트당 10,000행** 단위로 분할해 `snapshots/<id>/<table>.part-000.json`, `...part-001.json` 형태로 업로드.
- 파트별로 즉시 `sha256` 계산 후 청크 폐기 → 상시 메모리 O(파트 크기).
- 매니페스트 스키마 확장:
  ```ts
  tables: { name; rows; size_bytes; sha256; parts?: { path; rows; sha256; size_bytes }[] }[]
  ```
  `parts` 미존재 시 기존 단일 파일 경로 폴백(하위호환).
- `Hasher`를 스트리밍 방식으로 교체: 각 파트 sha256 hex를 순차로 다시 해시해 최종 매니페스트 해시 산출.
- `restoreSnapshot` / `buildSnapshotZip` / `deleteSnapshot`: `parts` 배열이 있으면 순회, 없으면 단일 파일 경로 사용.

#### 3) 클라이언트: 사전 스냅샷 UX 전환 (`src/lib/backup/pre-import-snapshot.ts`)
- `takePreImportSnapshotWithFeedback` 재작성:
  - `enqueuePreImportSnapshot` 호출(짧은 응답).
  - 성공 시 즉시 `toast.success("사전 스냅샷을 백그라운드에서 준비합니다")` 후 return `"queued"`.
  - 실패 시 `toast.warning("사전 스냅샷 접수 실패 — 임포트는 계속 진행합니다")` 후 return `"failed"`.
- 반환 타입에 `"queued"` 추가. 호출부(각 모듈 임포트 컨텍스트)는 `ok|timeout|queued` 모두 성공으로 취급하도록 처리(다수 파일은 이미 결과를 무시하고 계속 진행하므로 소폭 조정만 필요).
- soft-timeout 코드 및 관련 백그라운드 재통지 로직 제거.

#### 4) 조회/복원 UI 하위호환
- Backup 관리 화면·복원 흐름은 매니페스트의 `parts` 유무 자동 감지.
- `queued`/`running` 상태 표시가 `backup_run_log` 목록에 이미 존재하므로 라벨만 확인.

### 기술 세부

- 파트 크기 기본값: 10,000행/파트(≈5~15MB). 필요 시 상수 1곳(`CHUNK_ROWS_PER_PART`)에서 조정 가능.
- Storage 경로: `snapshots/<id>/<table>.part-<NNN>.json` + `manifest.json`.
- 무결성: 매니페스트 최상위 `sha256` = `sha256( concat( 각 파트 sha256 hex ) )`. 파트별 sha256도 별도 저장 → 부분 검증 가능.
- 동시성: `claim_backup_run`이 `UPDATE ... WHERE status='queued' RETURNING`으로 원자 전이. 실패 시 라우트는 200 no-op 반환.
- 실패 처리: 라우트 내에서 예외 시 `backup_run_log.status='failed'`, `error_message` 기록. 큐에서 자동 재시도는 하지 않음(운영자 판단).

### 검증
1. 대형 TM raw 임포트(수만 행) 시나리오에서 UI가 1~2초 내 접수 토스트를 받고 임포트가 정상 시작되는지 확인.
2. 백그라운드에서 `backup_run_log`가 `queued → running → success`로 전이되고 `snapshots/<id>/` 아래 `part-000..NNN.json`이 생성되는지 확인.
3. 기존 단일 파일 스냅샷 복원이 여전히 성공하는지(하위호환) 확인.
4. 새 청크 스냅샷을 대상으로 복원/ZIP 다운로드가 성공하는지 확인.

### 비영향 범위
- 사용자·역할·RLS 정책 변경 없음.
- 자동(23:50) 스냅샷 라우트도 동일 코어를 사용하므로 자동으로 청크 방식 이득을 봄.
