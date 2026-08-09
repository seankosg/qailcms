# ABD OCS 증분 업무 — 초보자용 8단계 Wizard UI

목표: `Import → ABD OCS` 탭을 8단계 Stepper 화면으로 재구성. 계산식·DB·RPC·보안 관문·Storage 정책은 손대지 않고, 화면·안내·활성화 조건·상태 복원만 개선한다. 실제 Baseline 생성·Upload·Snapshot·Import는 실행하지 않는다.

## 1. 요구사항 요약 (Step 1~8)

| Step | 구간 | 핵심 |
|---|---|---|
| 1 Download Latest Baseline | Preparation | Generate → Download ZIP, Baseline ID·생성시각·latest import run·행수·ZIP size·Latest/Outdated, "I saved the Baseline ZIP..." 사용자 확인 |
| 2 Prepare OCS Files | Preparation | 신규·개정 Excel만 준비 안내 + 체크박스 3종 (업로드 없음) |
| 3 Build Increment Package | Preparation | 로컬 Skill 정본 흐름 doctor→verify-baseline→plan→prepare→extract→review→package, Win/mac 사전확인, review blocker 안내, 완료 확인 체크 |
| 4 Select & Check Package | Import | ZIP 1개 선택·거부 규칙·요약 표시·Dry-run(`Check Package — No Data Will Be Changed`)·초록/주황/빨강 판정·완료 패키지 차단 |
| 5 Upload & Verify Files | Import | 업로드 n/total, 서버 검증 n/total, skipped·failed·경과시간, `Retry Failed Files` |
| 6 Create Pre-import Backup | Import | tables done/total·current table·경과시간·크기, 실패 시 5요소 오류 카드 + Retry, Snapshot ID 자동 연결 |
| 7 Review & Import | Import | 최종 요약 + 승인 체크 + 확인 Dialog + indeterminate 진행 + 항등식 실패 시 success 금지, 부분 반영 시 재시도 금지 문구 |
| 8 Complete | Import | 성공 카드·핵심 수치·JSON 접기·`View Import Log`/`Open ABD Raw Data`/`Copy Run ID` |

## 2. 현재 기능 → Step 매핑

| Step | 현재 구현 |
|---|---|
| 1 | `OcsBaselineCard` (createOcsBaseline / signOcsBaseline) |
| 2 | 없음 — 신규 안내 카드 |
| 3 | 없음 — 신규 안내 카드 (로컬 Skill 명령 안내) |
| 4 | `OcsIncrementImportPanel` 파일 선택 → `readIncrementPackage` → `ocsIncPrecheck` → `checkPackageStorageCollisions` → `runDryRun`(stage load + `ocsIncDryRun`) |
| 5 | `uploadAssets`(동시성 5, upsert:false) + `ocsIncVerifyBatch`(batch 50) + receipts |
| 6 | `runSnapshot`(`createPreImportSnapshot` + 3초 `getBackupRunStatus` 폴링) |
| 7 | approved 체크 + `blockers` + `ocsIncImport` + importRunning/indeterminate |
| 8 | 결과 JSON 표시(현재 raw 위주) |

즉 4~7단계 로직은 이미 존재하며 **버튼 나열형 → 단계형 카드로 재배치**가 주 작업이다. 판정·항등식·관문 코드는 이동만 하고 수식은 그대로 둔다.

## 3. 상태 복원 (§10)

서버 정본으로 복원 가능:
- Step 4 완료/차단: 같은 ZIP 재선택 시 `ocsIncPrecheck`의 `duplicate_package` / `duplicate_recovered` → `success` / `recovered` 차단 상태 (이미 구현, 문구를 스펙 문장으로 교체)
- Step 5: `checkPackageStorageCollisions`(서버 object 실측) + `ocsIncVerifyBatch` 재검증으로 uploaded/verified 재확인
- Step 6: `getLatestPreImportSnapshot` / `getBackupRunStatus`로 backed up 복원
- Step 7·8: `abd_ocs_import_logs` 조회로 importing/success/failed/partial 판정

복원 불가(현재 배관 기준):
- Step 1 Baseline: 새로고침 후 최신 Baseline 메타를 읽는 **읽기 전용 조회 경로가 없음**(생성 시 반환값만 존재). ZIP은 재선택 없이 복원 불가.
- Step 2·3 사용자 확인 체크박스: 로컬 작업이므로 서버 정본 없음 → localStorage 저장 + "화면 기록일 뿐 검증은 Step 4에서 수행" 명시.

## 4. UI-only 가능 / 서버 필요

UI-only(이번 범위): Stepper, 잠금·비활성 사유, 안내 문구, Dry-run 결과 표 재구성, 오류 5요소 카드, Technical details 접기, 반응형/접근성, Step 8 카드, 복사 버튼, 완료 패키지 차단 문구.

서버 추가가 필요한 항목(이번엔 미구현, 승인 시 별건):
1. Step 1 Baseline 최신 상태 조회(읽기 전용) — 없으면 새로고침 후 Step 1은 "미확인"으로 표시하고 재생성 유도.
2. Import 진행 중 서버 단계 실시간 표시 — 단일 원자 RPC라 서버 중간 신호 없음 → 스펙대로 indeterminate + 경과시간만 표시.
3. 새로고침 후 package hash로 upload receipt 자동 복원 — 영수증 저장 테이블이 없어 collision/verify 재실행으로 대체.

## 5. 변경 예상 파일

- 신규 `src/components/abd/ocs/wizard/OcsWizardStepper.tsx` — 8단계 Stepper(가로/세로, 5색 상태, aria)
- 신규 `src/components/abd/ocs/wizard/OcsWizardStepCard.tsx` — 펼침/접힘·완료 요약·비활성 사유 공용 카드
- 신규 `Step1Baseline.tsx` / `Step2PrepareFiles.tsx` / `Step3BuildPackage.tsx` — Step 1~3
- 신규 `Step4SelectCheck.tsx` / `Step5UploadVerify.tsx` / `Step6Backup.tsx` / `Step7ReviewImport.tsx` / `Step8Complete.tsx` — 기존 패널 로직을 옮겨 담는 표현 컴포넌트
- 신규 `src/components/abd/ocs/wizard/OcsIncrementWizard.tsx` — 상태 컨테이너(기존 `OcsIncrementImportPanel` 상태·핸들러 이관)
- 신규 `src/components/abd/ocs/wizard/OcsErrorCard.tsx` — What happened / affected / next / Run ID / Technical details
- 수정 `src/components/abd/ocs/OcsIncrementImportPanel.tsx` — 로직 보존한 채 Wizard 렌더로 전환(계산식·blockers·항등식 문자열 그대로 이동)
- 수정 `src/components/abd/ocs/OcsBaselineCard.tsx` — Step 1 규격 문구·버튼명·Technical details 접기·저장 확인 체크박스
- 수정 없음: 모든 `src/lib/abd/ocs-*.functions.ts`, DB 마이그레이션

## 6. 활성화 조건

- Step 2 ← Step 1의 "I saved the Baseline ZIP on this computer." 체크
- Step 3 ← Step 2 체크박스 3종
- Step 4 ← Step 3 완료 확인 체크
- Step 5 ← 패키지 검증 + Storage 충돌 점검 + Dry-run 통과(blockers 0)
- Step 6 ← 업로드 실패 0 + 서버 검증 완료(verified = newAssetTotal)
- Step 7 ← Snapshot 성공(Dry-run 이후 생성분)
- Step 8 ← Import 성공 + 항등식 전부 일치

기존 `blockers` 배열은 유지하되 **각 항목을 소속 Step에 배분**해 해당 단계 버튼 아래에만 사유를 표시한다.

## 7. 확인이 필요한 사항

1. Step 1 상태를 새로고침 후에도 서버 정본으로 복원하려면 읽기 전용 조회 함수 1개 추가가 필요합니다. 이번 라운드에서 추가할지, 아니면 "새로고침 시 Step 1 재확인 필요"로 두고 별건으로 뺄지 지정해 주십시오.
2. 기존 `OcsIncrementImportPanel`의 버튼 나열형 화면은 **완전히 대체**합니다(병행 노출 없음). 유지가 필요하면 알려주십시오.
3. 안내 문구는 한국어 기본, 스펙에 영어로 명시된 버튼·완료 문구(`Choose Increment ZIP`, `All files were uploaded and verified successfully.` 등)는 원문 그대로 사용합니다.