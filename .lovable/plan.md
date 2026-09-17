# TOC 4단계 — 업로드 파일 검증 결과 + 임포트(왕복 양식) · 대시보드 · 진행 화면

## 0. 올려주신 두 파일 검증 결과 — 결론: T&C 현황 갱신용으로는 불충분

현재 TOC 항목은 115건 전부 **Plot D**, 기준은 항목 키(`item_key`, 예: `SOW-Mechanical (HVAC)-Chiller Network-1`)와 시스템/서브시스템입니다. T&C 밴드는 단계 하나(`T&C Completion`, 완료 코드 `Completed`)와 수량(`tac_qty_total` / `tac_qty_issued`)로 관리됩니다.

**Ballance_T_C_elec (엑셀)**
- 단위가 항목이 아니라 계통(LV / LCS / FA / Comm / Security / MMDS / ITS)의 **잔여 물량 요약**입니다. TOC 전기 항목(24 계통, 41건)과 축이 달라 1:1로 붙일 키가 없습니다.
- 완료 일자가 없고 목표월(9/15·9/30·10/31·11/30) 칸에 잔여 수량만 있습니다. 상태는 B / UR / NS / C 혼합 표기(한 칸에 여러 코드)라 항목 하나의 완료 여부로 환산되지 않습니다.
- 총 물량(Equip. Qty)과 잔여만 있어 "발행 수량"과 정의가 다릅니다.

**MechDR_CSI_TC (PDF)**
- 항목 단위 표라 형태는 가깝습니다(Q'ty / Not Raised / U/R / Code-C / Code-B / Code-A / Status / Target Date). 다만
  - **잔여 작업만** 담겨 있어 이미 끝난 항목이 파일에 없습니다(빈칸 = 완료인지 미제공인지 구분 불가).
  - 키가 `CMS Code`(ME-C-26-01 등)인데 TOC 항목에는 그 컬럼이 없고, 값도 상당수가 `-` 입니다.
  - Plot C 표가 절반인데 TOC 항목에는 Plot C가 없습니다.
  - PDF는 셀 병합·줄바꿈이 많아 기계 판독이 불안정합니다(정기 갱신 원천으로 부적합).

**필요한 최소 정보**: 항목을 특정할 키(항목 키 또는 코드) + T&C 완료 여부·완료일 + 총 수량 / 완료 수량. 두 파일 모두 앞의 두 가지가 없습니다.

### 권장 대안
1. **(권장) TOC 왕복 양식으로 갱신** — 아래 1항의 양식에 T&C 열(총수량·완료수량·완료코드·계획일·실적일)을 넣어 내려받고, 담당자가 그 파일만 채워 올립니다. 항목 키가 파일에 박혀 있어 매칭 실패가 없습니다.
2. **보조 소스로 병행** — 두 파일을 계속 쓰려면 (a) 항목에 `cms_code` 를 추가하고 (b) 엑셀 계통명 ↔ 항목 키 매핑표를 1회 확정해야 합니다. 그 뒤에는 수량·상태만 갱신하는 별도 임포트를 붙일 수 있습니다. PDF 대신 **그 PDF의 원본 엑셀**을 주셔야 합니다.
3. 이번 라운드는 1안으로 가고, 2안은 매핑표가 준비되면 별도 라운드로 진행.

## 레퍼런스 실측 (파일:라인)

| 항목 | SPL 원본 | TOC 신규 |
|---|---|---|
| 왕복 양식 Export | `src/lib/spl/roundtrip-export.ts:35-145` (4행 헤더, Plot별 시트, `styleRoundtripSheet`) | `src/lib/toc/roundtrip-export.ts` |
| 파서 | `src/lib/spl/hdec-parser.ts:407-560` (헤더명 기준, 병합셀 forward-fill, `makeDateAudit`, NA 표기) | `src/lib/toc/hdec-parser.ts` |
| 임포트 서버 함수 | `src/lib/spl/hdec-import.functions.ts:121-391` (`rcl_grants`, `assertImportScope`, 컬럼부재=미제공/공란=삭제, 삭제 가드, 로그) | `src/lib/toc/hdec-import.functions.ts` |
| 임포트 화면 | `src/components/spl/import/SplImportPage.tsx:126-416` (Choose file → Preview(Diff) → Apply) | `src/components/toc/import/TocImportPage.tsx` |
| 대시보드 | `src/components/spl/dashboard/SplDashboardPage.tsx:49-267`, `SplBreakdownCards.tsx`, `SplPlanVsActualCard.tsx` | `src/components/toc/dashboard/*` |
| 진행 화면 | `src/components/spl/progress/SplProgressPage.tsx:36-525`, `SplStageBox.tsx` | `src/components/toc/progress/*` |
| 임포트 허브 탭 | `src/components/import-log/ImportHubPage.tsx:43,63` | 같은 파일에 TOC 탭 추가 |

## 1. 왕복 양식 (Export → 재임포트 시 변경 0건)

- 시트: `TOC Plot 3`(=C) / `TOC Plot 4`(=D). 4행 헤더는 SPL 과 동일 구조, 밴드 라벨은 T&C / O&M / Training / Asset Tag / As-Built / Service Report / TOC.
- 매칭 키는 **`ITEM KEY`** 로 합니다. 원천의 `Item No` 는 그룹별 번호라 중복(1이 여러 건)이어서 키로 못 씁니다. 양식에는 `ITEM KEY`(수정 금지 열) + `ITEM NO`(참고)를 함께 실습니다.
- 입력칸: 코드형 1열 / 단일일자 Plan·Actual 2열 / 기간형 4열. T&C 밴드에는 총수량·완료수량 2열을 추가합니다.
- 수기 금지 열(식별·파생·판정)은 파서가 무시 목록으로 보고합니다.

## 2. 임포트 파서·적재 규칙

- 헤더는 텍스트로만 찾습니다. 못 찾으면 미매핑으로 남기고 그 열은 제외(위치 추정 금지).
- 값 형태가 정의와 다르면 미매핑으로 강등(임계 80%, 키 열 90% 미만이면 중단). 강등 표시에 실측 비율·모집단·표본 3건.
- 코드형 단계 값은 완료 코드 사전과 대조. 사전에 없으면 저장 거부하고 값·건수·예시를 보여 줍니다(추측 금지).
- 팀은 Civil→ARCH 정규화, 원문은 `team_raw` 보관.
- 미매핑·강등은 전부 노출하고, "이 컬럼들 없이 진행" 승인 후에만 Start 활성화. 그 선택은 로그에 남깁니다.
- 권한은 `rcl_grants('TOC','import')` 만 근거. 행 단위 스코프는 서버에서 재판정.
- 제외 행은 사유별로 세어 화면·로그 양쪽에 남기고, 항등식(파싱 = 반영 + 권한제외 + 스코프제외 + 중복 + 거부 + 정책스킵)이 안 맞으면 미분류로 노출.
- 상태는 반영 = 파싱일 때만 `success`, 반영 0 이면 `failed`, 그 외 제외·거부가 있으면 `partial`.
- 적재는 새 마이그레이션의 `toc_hdec_apply(...)` 한 곳에서만, 이력은 `toc_change_log` 에. 삭제 규모 가드는 `toc_settings.delete_guard`(5% / 50건).

## 3. 대시보드 `/closure/toc/dashboard`

- 데이터는 정본 `toc_rows_as_of` 만 사용(화면 재계산 금지), 기준일 선택기 포함.
- 판정 8종 카드 + 준비 밴드 7종 진도 + TOC 상태(Code A / UR IFM / Code C / 미제출).
- 선후관계 경보 카드: 교육 미연결, 준비 전 TOC 제출, TAC 이전 교육.
- 계획 대비 실적 곡선: 밴드 7계열 / 단계 12계열 토글, Day·Week·Month, 기간 토글, Baseline·Remaining (`src/lib/spl/scurve.ts` 규칙을 `src/lib/toc/scurve.ts` 로 이식).
- 카드 클릭 시 Raw Data 동일 조건 드릴다운.
- **합계 = 모집단 검산**: 모든 분포에 미분류 버킷을 두고 총합 = 대상 행 수 표시.

## 4. 진행 화면 `/closure/toc/progress`

- 레인 = 밴드 7종(병행), 단계 박스에 완료·진행·지연·계획·미착수·해당없음 6칸.
- 밴드별 진도율, 게이트 라인(T&C 완료가 교육 개시 게이트), Current Stage 는 레인별 계산.
- 박스 클릭 → 하단 상세 → 행 클릭 시 Raw Data 드릴다운.
- 교육 밴드는 저장값이 아니라 연결된 교육 세션 롤업 값을 표시.

## 5. 배선

- 라우트 추가: `closure/toc/dashboard.tsx`, `closure/toc/progress.tsx`. 임포트는 기존 허브(`/import-log/import`)의 TOC 탭.
- 좌측 메뉴 `Handover (TOC)` 하위: Dashboard · Raw Data · Progress.
- Import Logs 에 TOC 탭, 되돌리기 종류에 TOC 등록, 백업 대상 테이블에 TOC 포함 여부 검산.

## 사전 승인이 필요한 사항

1. 왕복 양식 매칭 키를 `Item No` 가 아니라 `Item Key` 로 하는 것.
2. 올려주신 두 파일은 이번 라운드 임포트 원천으로 쓰지 않고, 위 1안(왕복 양식)으로 갱신하는 것. (2안 병행을 원하시면 `cms_code` 추가 + 계통 매핑표 확정이 선행 필요)
3. 2단계 적재 때 코드형으로 둔 자산태그 설치·서비스리포트 발행 단계를 그대로 유지할지, 날짜형으로 되돌릴지.
4. 대시보드에 SPL 과 동일한 계획 대비 실적 곡선(버킷·기간·계획 모드 토글)을 넣는 것.

## 검산 보고 항목

행수 115 일치, 왕복 재임포트 변경 0건, 임포트 항등식 일치, 판정·밴드 카드 합계 = 모집단, 진행 화면 6칸 합계 = 항목 수 × 단계 수, 과거 기준일에서 실적 비어 있음.
