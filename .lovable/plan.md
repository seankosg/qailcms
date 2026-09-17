# 전기 T&C 잔여 파일로 인계(TOC) 현황 갱신

전기 파일(`Ballance_T_C_elec...` 의 `Detail Status (260916)` 시트)을 정기 갱신 원천으로 받아들이는 두 번째 임포트 경로를 만듭니다. 기존 왕복 양식 임포트는 그대로 두고 별도 탭으로 추가합니다.

## 실측 전제

- 대상 시트는 30행(잔여 T&C 작업 단위), Description 20종. 앱 전기 서브시스템 41개와 이름이 그대로 일치하는 건은 0건.
- Status 값은 `B`, `C`, `NS`, `UR`, `0`, 그리고 `B, UR, NS` 처럼 한 칸에 여러 값이 섞인 형태.
- Completion 은 2026-09-15 / 09-30 / 10-31 / 11-30 네 구간 열이며 값은 잔여 수량.

## 확정된 규칙

1. 이름 매칭은 **대응표**로 합니다. `시스템 + Description` → 앱 항목 키의 대응표를 관리자가 화면에서 확정하고, 이후 임포트는 그 표만 사용합니다. 표에 없는 조합은 추측하지 않고 "미연결"로 남겨 화면과 로그에 전부 노출합니다.
2. Status → 현재 상태
   - `0` (O) = Code A
   - `B` = Code B (교육 진행 가능, 최종적으로 Code A 필요)
   - `C` = Code C (반려, 재수행)
   - `UR` = 검토 중
   - `NS` = 미착수
   - 여러 값이 섞이면 **가장 낮은 단계**를 대표 상태로 쓰고(미착수 < 검토중 < Code B < Code A, Code C 는 반려로 별도 표시), 원문 문자열은 그대로 보관해 화면에서 보여줍니다.
3. 종료목표일 = 숫자가 들어 있는 Completion 열 중 **가장 늦은 열의 날짜**. 이 값을 해당 항목의 **T&C 완료 계획일**로 넣습니다. 숫자가 하나도 없으면 계획일을 비우지 않고 기존 값을 유지합니다.
4. 파일에 없는 전기 항목은 **T&C 완료**로 간주합니다. 다만 완료 날짜가 파일에 없으므로 날짜를 임의로 만들지 않고 완료 상태만 기록합니다.
5. Code B 는 교육을 진행할 수 있어야 하므로, 현재 "T&C 완료 전 교육 실적 입력 금지" 규칙을 **Code A 또는 Code B 이상이면 허용**으로 완화합니다.

## 만드는 것

**1) 대응표 화면 (관리자)**
- 파일의 30개 조합과 앱 전기 항목 41개를 좌우로 놓고 연결하는 화면.
- 미연결 건수, 중복 연결(한 앱 항목에 여러 파일 행), 미사용 앱 항목을 항상 숫자로 표시.
- 한 앱 항목에 여러 파일 행이 붙는 경우(예: LCS 의 Lux Test / Normal Light Scenes)는 정상으로 보고, 상태는 가장 낮은 단계, 계획일은 가장 늦은 날짜로 합칩니다.
- 확정된 대응표는 데이터베이스에 저장되어 다음 갱신 때 자동 적용됩니다.

**2) 전기 T&C 임포트 탭**
- Import 화면에 "전기 T&C 잔여" 탭 추가. 파일 선택 → 미리보기(변경 대비) → 반영.
- 미리보기에 표시: 연결됨 / 미연결 / 상태 변경 / 계획일 변경 / 파일에 없어 완료로 바뀌는 항목 수, 그리고 "파싱 = 반영 + 변경없음 + 미연결 + 거부" 검산.
- 미연결이 하나라도 있으면 "이 항목들 없이 진행" 을 명시적으로 승인해야 반영 버튼이 활성화되고, 그 선택은 임포트 기록에 남습니다.
- 반영 권한은 기존 인계 모듈 임포트 권한을 그대로 씁니다.

**3) 갱신 후 확인**
- 원자료·대시보드·진행 화면에서 전기 41개 항목의 합계가 모집단과 일치하는지, Code B 항목의 교육 입력이 열리는지 실측합니다.

## 사전 승인이 필요한 변경 (승인 후에만 시행)

- 항목 상태 값에 **Code B** 추가 (현재 허용값: 미제출 / 검토중 / Code A / Code C). 원자료·대시보드·진행 화면의 상태 표시와 판정에 새 값이 반영됩니다.
- 교육 실적 입력 가드 완화: T&C 완료 → **Code A 또는 Code B**.
- 대응표 저장용 신규 테이블 1개 추가.
- 이 세 가지 외에 기존 판정식·화면 구성은 바꾸지 않습니다.

## 기술 사항

- 신규 테이블 `toc_elec_system_map(plot, team, source_system, source_description, item_key, is_active, 감사 컬럼)` + RLS/GRANT, `(plot, source_system, source_description)` 고유.
- `toc_items.toc_status` CHECK 제약에 `Code B` 추가, `toc_assert_row_rules` 의 교육 가드 조건에 Code B 허용.
- 파서 `src/lib/toc/elec-tc-parser.ts`: 시트명 `Detail Status (...)` 접두 인식, `System` 행 기준으로 블록 분리, 병합셀 좌측 라벨 forward-fill, `Total` 행 제외, 헤더 텍스트로만 열 매핑(위치 추정 금지), Status 다중값 파싱, Completion 열 헤더 날짜 파싱, 형태 검증 실패 시 해당 열 미매핑 강등.
- 서버 `src/lib/toc/elec-tc-import.functions.ts`: `rcl_grants('TOC','import')` + `assertImportScope` 재판정, 대응표 조회 → 항목 매칭 → 상태·T&C 계획완료일 upsert(`TAC_COMPLETION` 계획완료일, `toc_status`), 파일 부재 항목의 T&C 완료 처리는 상태만, `toc.change_source='elec_tc_import'` 감사, 행별 로그와 `success/partial/failed` 판정.
- 화면 `src/components/toc/import/TocElecTcImportPage.tsx`, 대응표 화면 `src/components/toc/admin/TocElecMapPage.tsx` + 라우트/메뉴 배선.
