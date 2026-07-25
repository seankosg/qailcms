
# ABD 대시보드 v5 - 단계별 실행 계획

작업 규모가 매우 크므로 **7단계**로 분할하여 각 단계 완료 후 검증하고 다음 단계로 넘어가는 방식으로 진행합니다. 사용자는 각 단계 완료 시점에 회귀 여부를 확인할 수 있습니다.

## 스코프 확정 (레퍼런스-우선 원칙)

- Aconex 파일: `Plot_D_ABD_1_Aconex.xlsx` (Docs 시트, 헤더는 row 1, `Document No`/`Status`/`Revision`/`Date Modified` 컬럼 확인 완료)
- HDEC 파일: `PLOT_C_D_MECH_ABD_완료계획_DB_260713.xlsx` 등 기존 원본
- 참조 프롬프트: `ABD_KPI_Prompt.md`, `aconex_status_update_prompt.md`
- 기존 1단계 마이그레이션(파생 컬럼, 트리거, `abd_settings`)은 이미 적용된 상태 — 재활용

## Phase 1: Aconex 파서 + Fingerprint + Import UI 분기
- `src/lib/abd/aconex-parser.ts` 신규: `Document No`/`Status` 분할(A/B/C/Cancelled)/`Date Modified`/`Revision` 추출
- `src/lib/import/module-fingerprint.ts`: `abd-aconex` 서브 타입 감지 (헤더: File + Document No + Status + Review Status)
- `src/components/abd/import/AbdImportPage.tsx`: 파일 지문에 따라 "HDEC 계획" vs "Aconex 실적" 자동 분기 표시, 이미 존재하는 doc_no만 UPDATE (신규 INSERT 금지)
- 검증: 업로드된 Aconex 샘플로 preview → 매칭 개수/미매칭 목록/Status 분포 확인

## Phase 2: HDEC 파서 개편
- Draft Start/Finish 분리(DS/DF)
- Response Result(A/B/C) 별도 필드
- `batch_no` 컬럼 매핑
- Round별 SB Plan/Actual, RS Plan/Actual 표준화
- 헤더 매핑 갱신, 기존 mapping row 재사용

## Phase 3: RPC 7종
- `abd_dashboard_row1` (배타 5분류: 전체/승인/UR/DS/NS + Team 브레이크다운)
- `abd_dashboard_row2` (지연 5분류: 총합/RS/SB/DS/NoPlan)
- `abd_status_dist`, `abd_approval_trend`, `abd_overdue_heatmap`
- `abd_attention_lists` (Needs Planning, UR Aging)
- `abd_crosscut` (Team × Plot × Round)

## Phase 4: Dashboard Row 1~6 재작성
- `AbdKpiCard` 신규 (SCR-20260725-nlvc.png 레퍼런스: KPI + progress bar + 우측 Team 브레이크다운)
- Row 1(배타 5분류 카드), Row 2(지연 5분류), Row 3(Status 분포+Approval 추세), Row 4(지연 히트맵), Row 5(Attention 리스트), Row 6(Crosscut 매트릭스)
- 카드 클릭 → Raw Data 필터 이동

## Phase 5: UR Aging 설정 popover + Progress SSOT + Raw Data 뱃지
- `abd_settings`의 UR Aging 임계값을 Dashboard 우상단 popover에서 편집
- Progress Page를 신규 RPC(SSOT)로 재배선
- Raw Data 테이블에 `current_stage`, `bucket_top`, `delay_bucket` 컬럼/뱃지 노출

## Phase 6: Admin - Aconex 탭 + source_group 뱃지
- `AbdHeaderMappingTable`에 Aconex 소스 탭 추가
- `AbdFieldConfigTable`에 `source_group` 컬럼(HDEC/Aconex/Computed) 뱃지

## Phase 7: 회귀 검증 + Migration 2 (구 컬럼 DROP)
- 대시보드/Progress/Raw Data 회귀 시나리오 확인 후 구 컬럼 DROP 마이그레이션

---

## 진행 방식

**즉시 Phase 1부터 순차적으로 진행합니다.** 각 Phase 완료 시 요약을 보고하고, 사용자가 "다음" 또는 특정 회귀를 지적하면 즉시 후속 조치합니다.

**질문 (Phase 4 진입 전 답변 필요):**

1. Row 1의 "UR"에는 Aconex `For Review` + HDEC 측 Submission 완료 후 미결(response 없음) 도면 모두 포함해야 하나요, 아니면 Aconex Under Review만 포함하나요?
2. Row 2 "No Plan"의 정의: (a) RS Plan/SB Plan 모두 공란 (b) 현재 활성 라운드의 Plan 공란 — 어느 쪽인가요?
3. UR Aging 기준일: `Date Modified` (Aconex 최종 수정) vs Submission Actual 날짜 — 어느 기준인가요?

Phase 1~3은 위 질문 없이도 진행 가능하므로, 승인 즉시 시작하겠습니다.
