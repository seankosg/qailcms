## 진행 순서 (T2 제외)

**1) T4 — ABD Round 계획/지연 알림 → Inbox·MWS 연동**
**2) T7 — ABD 데이터 백업/복원 편입**
**4) T10 — 문서/온보딩 정리**
**5) T1·T3·T5·T6 마무리 후 배포 체크**

---

## 1) T4 — Attention 알림을 Inbox·MWS로 연동

**현황**  
- MWS ABD 섹션은 이미 `계획필요`, `지연`, `임박` KPI + 뱃지가 표시됨.  
- `CommentsInbox`는 **댓글 전용**이라 계획필요/지연은 노출되지 않음.

**변경**  
- `src/hooks/useAbdAttentionInbox.ts` 신설: `abd_items_raw`에서 (a) `needs_planning=true` 또는 `active_round`가 `B/C` 이후 미계획, (b) `is_delayed`, (c) `is_upcoming` 3버킷 조회 (내 PIC/팀 기준, admin은 전체).  
- `src/components/my-work-space/AttentionInbox.tsx` 신설: CommentsInbox 아래에 배치. 탭은 `계획필요 / 지연 / 임박`, 각 항목 클릭 시 ABD Raw Data 상세 시트로 딥링크(`?detail=<id>&round=r2` 등). 읽음처리는 localStorage 기반 `useCommentInboxRead` 패턴 재사용.  
- `MyWorkSpacePage.tsx` 내 `<CommentsInbox />` 하단에 `<AttentionInbox />` 삽입.  
- 대시보드 Attention 카드에서도 동일 딥링크 사용 확인.

---

## 2) T7 — ABD 데이터 백업/복원 편입

**현황**  
- `backup_config` / `backup_run_log` / `database_snapshots` 인프라와 도하 23:50 스케줄 이미 존재 (SM/TM/DMR 등).  
- ABD 계열 테이블(`abd_items_raw`, `abd_settings`, `abd_field_config`, `abd_header_mappings`, `abd_import_presets`, `abd_comments`, `abd_change_log`, `defect_category_team_map` 제외)이 아직 백업 대상 등록 여부 불확실.

**변경**  
- `supabase--migration`으로 `backup_config` INSERT/UPSERT: ABD 관련 테이블 8개를 백업 대상에 추가 (없으면 삽입, 있으면 스킵).  
- Admin > Backup 페이지(`src/routes/_authenticated/admin/backup.tsx`) 카테고리 필터에 "ABD" 그룹 추가.  
- 복원(`rollback_abd_import` 이미 존재) 경로가 백업 스냅샷과 연동되도록 라우팅 확인.  
- 도하 23:50 자동 스냅샷에서 ABD가 실제로 백업되는지 dry-run 로그 확인.

---

## 4) T10 — 문서/온보딩

**변경**  
- `docs/abd-workflow.md` 신설: 4-stage 모델(Draft Start/Finish → Submission → DAR Response), 라운드/승인 규칙, Aconex 임포트 절차(토글 · 컬럼 선택 · Diff View), UR Aging 임계값 관리, `Document No` 유니크 키 규칙.  
- `docs/mws-workspace.md`: 담당/팀 필터, 계획필요/지연/임박 정의, Comments Inbox vs Attention Inbox 차이.  
- `docs/backup-restore.md`: 대상 테이블 목록, 도하 23:50 스케줄, 복원 절차.  
- 앱 내 `?` 헬프 링크는 이 단계에서는 미포함(별도 UX 결정 필요).

---

## 5) 마무리 및 배포 체크

**변경**  
- `tsgo` 타입체크 + `bun run build` 실행 로그 확인.  
- SM/TM/ABD Raw Data · MWS · Dashboard 3개 화면 Playwright 스모크(스크린샷 3장).  
- `security--run_security_scan` 실행 후 신규 이슈만 리뷰.  
- 최종 요약과 배포 안내(`publish` action) 노출.

---

## 기술 노트

- Attention Inbox는 read-model만 별도이며 **DB 스키마 변경 없음** (기존 컬럼만 사용).  
- 백업은 스키마 변경 없이 `backup_config` 데이터 시드만 갱신 → 데이터 조작은 `supabase--insert`.  
- Aconex API 자동 스케줄(`pg_cron`)은 이번 사이클에서 **명시적으로 제외**.

## 산출물 예상

- 신규: `useAbdAttentionInbox.ts`, `AttentionInbox.tsx`, docs 3개.  
- 수정: `MyWorkSpacePage.tsx`, `admin/backup.tsx`(카테고리), backup_config 시드.  
- 마이그레이션 0건, insert 1건.
