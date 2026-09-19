# 설비 T&C 잔여 파일로 인계(TOC) 현황 갱신

앞으로 설비는 `MechTC_DR.xlsx` 형식(시트 `Plot-D_Remaining Works Status`) 파일만 올리면 갱신됩니다. 함께 올려주신 매핑 제안 엑셀은 **1회용 규칙표**로만 씁니다.

## 갱신 파일 실측 (MechTC_DR.xlsx)

- 시트 1개, 본문 102행. 머리글 2줄 구조(3행: `System` / `Equipment / System Description` / `SOW_Mech` / `CMS Code` / `TARGET DATE`, 4행: `Q'ty` / `Not Raised` / `U/R` / `Code-C` / `Code-B` / `Code-A` / `Status`).
- `Status`는 `Closed` 70 · `Open` 32. **Closed 행은 미완료 수량이 전부 0**으로 일관됩니다.
- `SOW_Mech` 열에 앱 항목명이 이미 들어 있습니다. 값 55종 전부 앱 항목과 철자 일치(오값 0), 앱 설비 56개 중 55개 커버. 빠진 항목은 `CHW Pressurization Unit / Expansion Tanks-Chiller` 1건.
- `SOW_Mech` 공란 43행: TAB·Circuit 계열, `REFUGE FAN`, `VAV & CAV`, `PRV`, `GREY WATER PUMP`, BMS/SCADA 3행, Cold Room 2행 등.
- 한 항목에 여러 줄: `Air Cooled Chillers` 4행, `Smoke Extract Fan-SEF` 2행.
- `TARGET DATE` 공란 35행.

## 확정된 규칙 (승인 답변 반영)

1. 머리글은 **텍스트로만** 찾습니다. 위치·순서로 가정하지 않고, 못 찾은 열은 미매핑으로 남겨 전부 노출합니다.
2. 대표 상태:
   - `Status = Closed` → **T&C 완료**.
   - `Status = Open` → 수량 기준 **가장 낮은 단계**(Not Raised 미착수 < U/R 검토중 < Code-B < Code-A), `Code-C` 수량이 있으면 **반려(Code C)**. 수량 6종은 원문 그대로 보관합니다.
3. 한 항목에 여러 줄이 걸리면 **가장 낮은 단계 · 가장 늦은 목표일**을 채택합니다.
4. 종료목표일 = `TARGET DATE`. 공란이면 기존 값을 유지합니다(임의 생성 금지).
5. 파일에 없는 설비 항목은 **T&C 완료 상태만** 기록합니다(완료 날짜 생성 금지).
6. 연결 근거 우선순위: **대응표가 정본**. 파일의 `SOW_Mech` 값은 대응표에 없을 때 "후보"로만 제시하고, 사람이 저장해야 규칙이 됩니다. 두 값이 다르면 대응표를 쓰고 불일치를 화면·로그에 노출합니다.
   - 예: 이 파일은 `TAB AIR HANDLING UNITS`를 `Air Balancing AHU`로, 매핑 제안표는 `Fresh Air Handling Unit`으로 연결합니다 → 불일치로 표시합니다.
7. 대응표에 없고 후보도 없는 조합은 **미연결**로 전부 노출하며, "이 항목들 없이 진행"을 승인해야 반영이 열립니다.
8. Plot C 구간은 제외합니다(현재 앱 항목 전부 Plot D).

## 사전 보고가 필요한 설계 변경

- **신규 테이블 1개** `toc_mech_system_map` — `System` + `Equipment / System Description` 조합 → 앱 항목 키. `(plot, source_system, source_description)` 고유, RLS는 전기 대응표와 동일(조회 전원 / 저장은 TOC 임포트 권한).
- **신규 인계 항목 4건**(승인됨): `BMS-DDCP`, `SCADA System`, `Air-Cooled Chillers (CPM Integration)`, `Cold Room Accessories`. 팀 MECH · Plot D. 항목 수 115 → 119로 늘어나 판정 카드·밴드 합계 모집단도 119가 됩니다.
  - CPM 통합은 매핑 제안표에서 2줄(TES/Chiller)이지만 앱 항목은 1건으로 합칩니다.
- 기존 판정식·화면 구성·컬럼은 변경하지 않습니다.

## 구현 항목

| 구분 | 파일 | 내용 |
| --- | --- | --- |
| DB | 마이그레이션 | `toc_mech_system_map` 생성 + GRANT + RLS, 신규 항목 4건, 매핑 제안표(원문 순서 시트) 규칙 시딩 |
| 파서 | `src/lib/toc/mech-tc-parser.ts` | 시트·머리글 텍스트 탐색, 수량 6열 + Status + TARGET DATE, `SOW_Mech` 후보 수집, 합계·빈 행 제외 사유별 집계, 형태 검증 80% 미달 열은 미매핑 강등 |
| 서버 | `src/lib/toc/mech-tc-import.functions.ts` | `rcl_grants('TOC','import')` + 스코프 재판정, 대응표 매칭, 항목별 대표 상태·목표일 산정, `TAC_COMPLETION` 계획완료일·`toc_status` 갱신, 파일 부재 항목 완료 처리, 행별 로그와 `success/partial/failed` |
| 대응표 화면 | `src/components/toc/admin/TocMechMapPage.tsx` + 라우트 | 전기 대응표와 동일 구성. 파일의 `SOW_Mech` 값을 후보로 미리 채워 보여줍니다 |
| 임포트 화면 | `src/components/toc/import/TocMechTcImportPage.tsx` | Import 허브에 "설비 T&C 잔여" 탭. 파일 선택 → 미리보기(변경 대비) → 반영 |

## 검산

- 항등식: 파싱 102 = 반영 + 미연결 + 제외(빈 행·합계) + 거부.
- 원자료·대시보드·진행 화면에서 판정 합계 = 119, 설비 항목 60건(56+4) 합계 일치 확인.
- `bunx tsgo --noEmit` 통과, Playwright로 이 파일을 실제로 올려 미리보기·반영 왕복 검증.
