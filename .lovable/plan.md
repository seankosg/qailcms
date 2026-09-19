# 설비 T&C 잔여 파일로 인계(TOC) 현황 갱신

전기와 같은 구조를 설비에 추가합니다. 올려주신 엑셀은 **1회용 규칙표**로만 쓰고, 앞으로는 설비 T&C 잔여 파일(`PLOT-D MECH T&C REMAINING WORKS`의 원본 엑셀)만 올리면 갱신됩니다.

## 실측 근거

- 대응표 `매핑제안_R0`(원문 순서, 35행)이 정본입니다. PDF 30줄 → 앱 설비 항목 연결이 담겨 있습니다.
  - `매핑제안_R1`은 SOW 기준으로 다시 정렬하면서 원문 수량·상태·목표일이 옆 줄로 복제되었습니다(6쌍: 8·9 / 10·11 / 12·13 / 14·15 / 19·21 / 38·49). **R1은 쓰지 않습니다.**
- 대응표의 `Sub System / Equipment` 56개는 앱 설비 항목 56개와 **철자까지 100% 일치**합니다.
- 대상이 없는 5줄: CPM 통합 2종, SCADA System, BMS-DDCP, Cold Room Accessories → 앱에 항목이 없습니다(조회 결과 0건).
- `Plot-D_Remaining Works Status` 시트에 `SOW_Mech` 열이 이미 있어, 원본 엑셀에도 같은 열이 있으면 보조 근거로 씁니다.

## 확정된 규칙 (승인 답변 반영)

1. 갱신 원천 = **PDF를 만든 원본 엑셀**. 시트 제목 `PLOT-D MECH T&C REMAINING WORKS`, 머리글은 텍스트로만 찾습니다(`System`, `Equipment / System Description`, `Q'ty`, `Not Raised`, `U/R`, `Code-C`, `Code-B`, `Code-A`, `Status`, `TARGET DATE`). 위치·순서로 가정하지 않습니다.
2. 대표 상태 = **가장 낮은 단계**(미착수 < 검토중 < Code B < Code A), Code-C 수량이 있으면 **반려(Code C)**. 수량 6종은 원문 그대로 보관합니다.
3. 한 항목에 여러 줄이 걸리면 **가장 낮은 단계 · 가장 늦은 목표일**을 채택합니다.
4. 종료목표일 = `TARGET DATE`. 값이 없으면 기존 값을 유지합니다(임의 생성 금지).
5. 파일에 없는 설비 항목은 **T&C 완료 상태만** 기록합니다(완료 날짜는 만들지 않음).
6. 대응표에 없는 조합은 **미연결**로 화면·로그에 전부 노출하고, "이 항목들 없이 진행"을 승인해야 반영이 열립니다.
7. Plot C 구간은 제외합니다(현재 앱 항목 전부 Plot D).

## 사전 보고가 필요한 설계 변경

- **신규 테이블 1개**: `toc_mech_system_map` — 파일의 `System` + `Equipment / System Description` 조합을 앱 항목 키에 연결. `(plot, source_system, source_description)` 고유, RLS는 전기 대응표와 동일(조회 전원, 저장은 TOC 임포트 권한).
- **신규 인계 항목 4건**(승인됨): `BMS-DDCP`, `SCADA System`, `Air-Cooled Chillers (CPM Integration)`, `Cold Room Accessories`. 팀 MECH, Plot D. 항목 수 115 → 119, 판정 카드·밴드 합계 모집단도 119로 바뀝니다.
  - CPM 통합은 대응표에서 2줄(TES/Chiller)이지만 앱 항목은 1건으로 합칩니다. 분리가 필요하면 말씀해 주세요.
- 기존 판정식·화면 구성·컬럼은 변경하지 않습니다.

## 구현 항목

| 구분 | 파일 | 내용 |
| --- | --- | --- |
| DB | 마이그레이션 | `toc_mech_system_map` 생성 + GRANT + RLS, 신규 항목 4건, 대응표 35행 시딩 |
| 파서 | `src/lib/toc/mech-tc-parser.ts` | 시트·머리글 텍스트 탐색, 수량 6열, Status, TARGET DATE, 합계·빈 행 제외 사유별 집계, 형태 검증 80% 미달 열은 미매핑 강등 |
| 서버 | `src/lib/toc/mech-tc-import.functions.ts` | `rcl_grants('TOC','import')` + 스코프 재판정, 대응표 매칭, 항목별 대표 상태·목표일 산정, `TAC_COMPLETION` 계획완료일·`toc_status` 갱신, 파일 부재 항목 완료 처리, 행별 로그와 `success/partial/failed` |
| 대응표 화면 | `src/components/toc/admin/TocMechMapPage.tsx` + 라우트 | 전기 대응표와 동일 구성(파일에서 조합 불러오기 → 항목 연결 → 저장) |
| 임포트 화면 | `src/components/toc/import/TocMechTcImportPage.tsx` | Import 허브에 "설비 T&C 잔여" 탭. 파일 선택 → 미리보기(변경 대비) → 반영 |

## 검산

- 항등식: 파싱 = 반영 + 미연결 + 제외(합계·빈 행·Status 공란) + 거부.
- 원자료·대시보드·진행 화면에서 판정 합계 = 119, 설비 항목 60건(56+4) 합계 일치 확인.
- `bunx tsgo --noEmit` 통과, Playwright로 미리보기·반영 왕복 확인.

## 남은 확인

파서의 머리글 매핑은 PDF 열 구성과 `Plot-D_Remaining Works Status` 시트로 만들지만, **실제 원본 엑셀 파일을 한 번 올려 주시면** 그 파일로 실측 검증까지 마칩니다.
