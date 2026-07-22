# 임포트 진행 중 취소 기능

모든 모듈(TM, SM, Spare Part, ABD, DMR)의 임포트 실행 도중 사용자가 취소할 수 있도록 통일된 취소 메커니즘을 추가합니다. 서버 트랜잭션을 중단시키는 것이 아니라, 클라이언트 측 청크 루프 사이에서 "취소 요청" 플래그를 확인하고 다음 청크로 넘어가기 전에 안전하게 중단합니다.

## 공통 설계

- 각 임포트 컨텍스트/페이지에 `cancelRequestedRef: MutableRefObject<boolean>`와 `isCancelling` 상태 추가.
- `requestCancel()` 함수 노출: 플래그를 `true`로 설정하고 토스트 "취소 요청됨. 현재 청크 완료 후 중단됩니다".
- 청크 upsert 루프 진입부에서 `if (cancelRequestedRef.current) break;` 체크.
- 중단 시:
  - 파일 상태를 `"cancelled"`로 설정하고 `error_message = "사용자 취소"`.
  - 이미 커밋된 청크는 유지 (부분 임포트). 로그에 처리된/스킵된 행 수 기록.
  - 임포트 로그 레코드(`*_import_logs`)의 `status = 'cancelled'`, `notes`에 "N/M 행에서 취소됨" 저장.
- 진행 완료/실패/취소 후 플래그 리셋.

## 파일별 변경

**공통 타입**
- `src/contexts/TaskManagementImportContext.tsx`, `DefectManagementImportContext.tsx`, `SparePartImportContext.tsx`
  - 상태 유니온에 `"cancelled"` 추가.
  - `cancelRequestedRef` 및 `requestCancel` 추가하여 Provider value에 노출.
  - 메인 upsert 루프(TM: 라인 766 근처 `INSERT_CHUNK` 루프, SM/SP도 동일 패턴)에서 각 배치 시작 시 취소 체크.
  - 파일 단위 for 루프(`for (const f of ready)`)에서도 다음 파일 진행 전 체크.

**ABD**
- `src/components/abd/import/AbdImportPage.tsx` (라인 222 루프)
  - `cancelRequestedRef` state 추가, 시트 단위 및 배치 단위 취소 체크.

**DMR**
- `src/components/resource/dmr/DmrImportPage.tsx`
  - `uploadAndParse`와 `saveAll` 두 단계 모두에 취소 지원. 업로드/파싱은 슬롯 단위, 저장은 배치 단위로 체크.

**UI (각 임포트 페이지)**
- `src/components/task-management/import/TaskManagementImportPage.tsx`
- `src/components/defect-management/import/DefectManagementImportPage.tsx`
- `src/components/spare-part/import/SparePartImportPage.tsx`
- `src/components/abd/import/AbdImportPage.tsx`
- `src/components/resource/dmr/DmrImportPage.tsx`

각 페이지의 진행 중 상태(`processing`)일 때 기존 "임포트 시작" 버튼 옆(또는 진행률 표시 옆)에 **빨간 outline "취소" 버튼** 노출. 클릭 시 확인 다이얼로그 → `requestCancel()`. `isCancelling` 상태에는 스피너 + "취소 중…" 라벨.

- 파일 목록 행에도 `"cancelled"` 상태 뱃지(회색 "취소됨") 표시.

## 기술 세부사항

- 사용자 취소로 중단된 행에 대해 사전 스냅샷(pre-import snapshot)은 그대로 유지되어 필요 시 롤백 가능. 임포트 로그 UI의 롤백 버튼은 `cancelled` 상태에서도 활성화.
- 취소 확인 다이얼로그 문구: "지금까지 처리된 N행은 저장된 상태로 유지되고, 이후 배치는 중단됩니다. 필요시 임포트 로그에서 롤백할 수 있습니다."
- SM 이분 탐색(binary split) 재시도 로직 안에서도 취소 체크를 넣어, 대용량 배치 재시도 중에도 즉시 반응.
- 취소 후 파일 재시도(재선택)를 방지하지 않음 — 사용자가 원하면 다시 시작 가능.

## 범위 제외

- 이미 커밋된 청크의 자동 롤백은 하지 않음 (기존 롤백 UI 사용).
- 서버 측 진행 중 트랜잭션 강제 중단(pg_cancel_backend) 없음 — 현재 청크는 정상 완료 후 다음 청크에서 중단.
