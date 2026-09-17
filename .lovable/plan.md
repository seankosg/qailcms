# TOC 4단계 — 임포트(왕복 양식) · 대시보드 · 진행 화면

승인된 TOC 계획의 다음 단계입니다. 레퍼런스는 SPL 모듈 원본을 실측해 이식하고, TOC 고유 규칙(밴드 7종 병행, 교육 롤업, 코드형 단계)만 다르게 처리합니다.

## 레퍼런스 실측 (파일:라인)

| 항목 | SPL 원본 | TOC 신규 |
|---|---|---|
| 왕복 양식 Export | `src/lib/spl/roundtrip-export.ts:35-145` (4행 헤더 r1 타이틀/r2 밴드/r3 단계/r4 Plan·Actual, Plot별 시트, `styleRoundtripSheet`) | `src/lib/toc/roundtrip-export.ts` |
| 파서 | `src/lib/spl/hdec-parser.ts:407-560` (헤더명 기준, 병합셀 forward-fill, `makeDateAudit`, NA 표기, View 양식 분기) | `src/lib/toc/hdec-parser.ts` |
| 임포트 서버 함수 | `src/lib/spl/hdec-import.functions.ts:121-391` (권한 `rcl_grants`, `assertImportScope`, 컬럼부재=미제공/공란=삭제, 삭제 가드, 로그/행로그) | `src/lib/toc/hdec-import.functions.ts` |
| 임포트 화면 | `src/components/spl/import/SplImportPage.tsx:126-416` (Choose file → Preview(Diff) → Apply, ScopeSummary, DateIssuesPanel, 삭제 가드 승인) | `src/components/toc/import/TocImportPage.tsx` |
| 대시보드 | `src/components/spl/dashboard/SplDashboardPage.tsx:49-267` + `SplBreakdownCards.tsx` + `SplPlanVsActualCard.tsx` | `src/components/toc/dashboard/*` |
| 진행 화면 | `src/components/spl/progress/SplProgressPage.tsx:36-525` + `SplStageBox.tsx` | `src/components/toc/progress/*` |
| 임포트 허브 탭 | `src/components/import-log/ImportHubPage.tsx:43,63` | 동일 파일에 TOC 탭 추가 |

## 1. 왕복 양식 (Export → Import 무변경)

- 시트: `TOC Plot 3`(=C) / `TOC Plot 4`(=D). 4행 헤더는 SPL 과 동일 구조, 밴드 라벨은 T&C / O&M / Training / Asset Tag / As-Built / Service Report / TOC.
- 매칭 키는 **`item_key`** 를 씁니다. 원천의 `Item No` 는 그룹별 번호라 중복(1이 50건)이어서 키가 될 수 없습니다. 양식에는 `ITEM KEY`(잠금 열) + `ITEM NO`(참고 표시) 둘 다 실습니다.
- 입력칸: 단계의 값 형식에 따라 코드형 1열 / 단일일자 Plan·Actual 2열 / 기간형 Plan·Actual Start·Finish 4열.
- 수기 금지 열(오렌지=식별, 초록=파생·판정)은 파서에서 무시 목록으로 보고합니다.
- 자체 검증: 내보낸 파일을 그대로 다시 올리면 변경 0건이어야 하며, 실측 결과를 보고에 넣습니다.

## 2. 임포트 파서·적재 규칙 (프로젝트 규칙 준수)

- 헤더는 **텍스트로만** 찾습니다. 못 찾으면 미매핑으로 남기고 그 열은 임포트에서 제외. 위치·순서 추정 코드 없음.
- 값 형태가 필드 정의와 다르면 헤더가 맞아도 미매핑으로 강등(임계 80%, 키 열 90% 미만이면 파싱 중단). 강등 표시에 실측 비율·모집단·표본 3건 표기.
- 코드형 단계(자산태그 설치, 서비스리포트 발행)의 값은 완료 코드 사전과 대조합니다. 사전에 없는 값은 저장을 거부하고 값·건수·예시를 보여 줍니다(추측 금지).
- 팀은 Civil→ARCH 정규화, 원문은 `team_raw` 보관.
- 미매핑·강등은 접지 않고 전부 노출하고, 사용자가 "이 컬럼들 없이 진행"을 승인해야 Start 활성화. 그 선택은 임포트 로그에 남깁니다.
- 권한은 `rcl_grants('TOC','import')` 만 근거. 행 단위 스코프는 서버에서 재판정.
- 제외 행은 사유별로 세고 화면·로그 양쪽에 남깁니다. 항등식(파싱 = 반영 + 권한제외 + 스코프제외 + 중복 + 거부 + 정책스킵)이 안 맞으면 미분류로 노출.
- 상태는 반영 = 파싱일 때만 `success`, 반영 0 이면 `failed`, 그 외 제외·거부가 있으면 `partial`.
- 적재는 새 마이그레이션의 `toc_hdec_apply(_batch_id, _patches, _allow_deletes, _delete_count)` 한 곳에서만 수행하고 변경 이력은 `toc_change_log` 에 기록합니다. 삭제 규모 가드 임계는 `toc_settings.delete_guard`(pct 5 / min_count 50)로 둡니다.

## 3. 대시보드 `/closure/toc/dashboard`

- 데이터는 정본 `toc_rows_as_of` 만 사용(화면 재계산 금지). 기준일 선택기 포함.
- 판정 카드 8종 + 준비 밴드 7종 진도(완료/진행/차단/미착수) + TOC 상태(Code A / UR IFM / Code C / 미제출).
- 선후관계 경보 카드: 교육 미연결, 준비 전 TOC 제출, TAC 이전 교육.
- 계획 대비 실적 곡선: 밴드 7계열 / 단계 12계열 토글, Day·Week·Month 버킷, 기간 토글, Baseline·Remaining 계획 모드 (`src/lib/spl/scurve.ts` 규칙을 `src/lib/toc/scurve.ts` 로 이식).
- 카드 클릭 시 Raw Data 로 같은 조건 드릴다운.
- **합계 = 모집단 검산**: 모든 분포·도넛에 미분류 버킷을 두고 총합 = 대상 행 수 표시.

## 4. 진행 화면 `/closure/toc/progress`

- 레인 = 밴드 7종(병행 진행), 각 레인에 단계 박스(완료·진행·지연·계획·미착수·해당없음 6칸).
- 밴드별 진도율, 게이트 라인(T&C 완료가 교육 개시 게이트), Current Stage 는 레인별로 계산.
- 박스 클릭 → 하단 상세 목록 → 행 클릭 시 Raw Data 드릴다운.
- 교육 밴드는 저장 스냅샷이 아니라 연결된 교육 세션 롤업 값을 그대로 표시합니다.

## 5. 배선

- 라우트 3개 추가: `src/routes/_authenticated/closure/toc/dashboard.tsx`, `progress.tsx`, 임포트는 기존 허브(`/import-log/import`)에 TOC 탭으로 편입(`route-access.ts` 의 `/closure/toc/import` 는 허브 탭으로 대체).
- 좌측 메뉴 `Handover (TOC)` 하위에 Dashboard · Raw Data · Progress 순으로 표시. Raw Data 화면의 Import 버튼은 허브 TOC 탭으로 연결.
- Import Logs 화면에 TOC 탭 추가, 되돌리기(rollback) 종류에 TOC 등록, 백업 대상 테이블 목록에 TOC 테이블 포함 여부 검산.

## 사전 승인이 필요한 사항

1. 왕복 양식의 매칭 키를 `Item No` 가 아니라 `Item Key` 로 하는 것(원천 번호 중복 때문).
2. 2단계 적재 때 임시로 코드형(`value_type='code'`)으로 둔 자산태그 설치·서비스리포트 발행 단계를 그대로 유지할지, 날짜형으로 되돌릴지.
3. 대시보드에 계획 대비 실적 곡선을 SPL 과 동일한 형태로 넣는 것(기간·버킷·계획 모드 토글 포함).

## 검산 보고 항목

행수 115 일치, 왕복 재임포트 변경 0건, 임포트 항등식 일치, 판정·밴드 카드 합계 = 모집단, 진행 화면 6칸 합계 = 항목 수 × 단계 수, 과거 기준일에서 실적 비어 있음.
