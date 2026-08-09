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

## 3. 상태 복원 — 실측 재확인 결과 (조건부 승인 §2·§3 반영)

DB 실측(읽기 전용):

| 대상 | 실제 정본 | 복원 가능 여부 |
|---|---|---|
| Verify receipt | `abd_ocs_inc_verify_receipts` (`run_id`, `package_id`, `bucket`, `path`, `expected_sha256`, `actual_sha256`, `ok`, `verified_at`) | **서버 복원 가능** — `package_id` 로 조회하면 검증 완료 목록·실패 목록을 그대로 복원 |
| Upload receipt | **전용 테이블 없음** — `UploadReceipt` 는 브라우저 state 전용 | 서버 복원 불가 → `checkPackageStorageCollisions` 의 **Storage object 실측 + verify receipt** 조합으로 대체 판정 |
| Snapshot | `backup_run_log`(`id`=run_id, `status`, `snapshot_id`, `metadata{kind,module,tables_*}`) · `database_snapshots.trigger_metadata{module, import_log_id}` | run_id 를 알 때만 `getBackupRunStatus` 로 복원. metadata 에 **package_id 는 기록되지 않음** |
| Import 결과 | `abd_ocs_import_logs` (`status`, `snapshot_id`, `dryrun`, `result`) | 복원 가능 |
| 완료·복구 패키지 차단 | `ocsIncPrecheck` 의 `duplicate_package` / `duplicate_recovered` | 복원 가능 |
| Baseline | private bucket `ocs-baselines/<baseline_id>/*.zip` + `manifest.json` sidecar | 조회 함수만 추가하면 복원 가능(§4) |

**Snapshot 복원 규칙(교정):** "가장 최근 ABD Snapshot" 이라는 이유만으로 재사용하지 않는다. 아래 셋 중 하나로 현재 패키지와의 연결이 증명될 때만 Step 6 완료로 인정한다.
1. 현재 세션에서 Dry-run 이후 생성한 backup run_id 를 `getBackupRunStatus` 로 재확인
2. 현재 package 의 `abd_ocs_import_logs.snapshot_id` 가 그 Snapshot 을 명시적으로 참조
3. Snapshot metadata 가 현재 package_id / stage run_id 를 담고 있음(현재 배관에는 없음 → 사실상 1·2 만 성립)

증명 불가 시: `A backup exists, but it cannot be confirmed for this package. Create a new pre-import backup.` 안내 + Step 7 잠금. Snapshot DB 계약은 이번 라운드에서 변경하지 않는다.

Step 2·3 확인 체크박스는 로컬 작업이라 서버 정본이 없다 → localStorage 저장 + "사용자 확인일 뿐, 실제 검증은 Step 4 서버 관문" 명시.

## 4. Step 1 Baseline 읽기 전용 조회 (승인분)

- 신규 서버 함수: `getLatestOcsBaselineInfo` (`src/lib/abd/ocs-baseline.functions.ts` 에 추가, strict admin, 읽기 전용)
- 조회 정본: 기존 판정식 그대로 — `abd_ocs_baseline_core_hash` + `abd_ocs_inc_baseline` → `computeBaselineId()` 로 **현재 core 기준 baseline_id 산출** → Storage `ocs-baselines/<baseline_id>/` 를 `list()` 하여 `*.zip` 존재 여부와 `manifest.json` sidecar 를 읽음
- 반환: `baseline_id`, `generated_at`, `data_date`, `latest_success_import_run_id`, `core_hash`(요약), dataset row counts, `zip_byte_size`, `storage_path`, `is_latest`
- 생성·업로드·서명 없음. signed URL 은 사용자가 Download 를 누를 때 기존 `signOcsBaseline` 으로만 발급
- 해당 폴더에 ZIP 이 없으면 `No Baseline has been generated yet` → Generate 유도
- 산식·마이그레이션 변경 없음

## 4-1. 그 밖의 UI-only / 제약

UI-only: Stepper, 잠금·비활성 사유, 안내 문구, Dry-run 결과 표 재구성, 오류 5요소 카드, Technical details 접기, 반응형/접근성, Step 8 카드, 복사 버튼, 완료·복구 패키지 카드.

서버 신호가 없어 불가: Import 진행 중 서버 내부 단계 표시(단일 원자 RPC) → 스펙대로 indeterminate + 경과시간 + 단계 안내 문구만.

추가 읽기 전용 함수 1개: `ocsIncListVerifyReceipts(package_id)` — 기존 `abd_ocs_inc_verify_receipts` 를 그대로 읽어 verify 상태를 복원한다(새 저장 방식 만들지 않음).

## 5. 컴포넌트 구조 (축소·controller 유지)

`OcsIncrementImportPanel` 을 **그대로 controller 로 유지**한다. state·handler(`onPick`/`runDryRun`/`uploadAssets`/`runUploadVerify`/`runSnapshot`/`runImport`)·`blockers` useMemo·항등식 문자열은 **이동하지 않고 위치도 순서도 그대로** 둔다. 신규 컴포넌트는 전부 props 만 받는 presentation 이며, 동일 state 를 이중 관리하지 않는다. `OcsIncrementWizard` 새 상태 컨테이너는 만들지 않는다.

- 신규 `wizard/OcsWizardStepper.tsx` — 8단계 Stepper(가로/세로, 5색+아이콘 상태, aria)
- 신규 `wizard/OcsWizardStepCard.tsx` — 펼침/접힘·완료 요약·비활성 사유 표시 공용 카드
- 신규 `wizard/OcsPreparationSteps.tsx` — Step 1~3(Baseline 카드 슬롯 + 체크리스트 + 로컬 Skill 안내 + `I already have a completed Increment ZIP`)
- 신규 `wizard/OcsImportSteps.tsx` — Step 4~8 표현(기존 Panel 의 JSX 를 props 로 받아 단계 카드 안에 배치)
- 신규 `wizard/OcsErrorCard.tsx` — What happened / affected / next / Run ID / Technical details
- 수정 `OcsIncrementImportPanel.tsx` — 로직 무변경, **렌더 트리만** Stepper + 단계 카드 배치로 교체
- 수정 `OcsBaselineCard.tsx` — Step 1 규격 문구·버튼명·최신 Baseline 조회 표시·Technical details 접기·저장 확인 체크박스
- 수정 `src/lib/abd/ocs-baseline.functions.ts` — `getLatestOcsBaselineInfo` 읽기 전용 함수 추가(기존 함수 무변경)
- 신규 `src/lib/abd/ocs-increment-receipts.functions.ts` — verify receipt 읽기 전용 조회
- 변경 없음: DB 마이그레이션, 모든 RPC, 판정식, Storage 정책

## 5-1. 완료·복구 패키지 표시 (§7)

동일 success/recovered 패키지 선택 시 파일 선택을 지우지 않는다. 파일명·package ID 를 유지한 채 완료 상태 카드(`Already imported` / `Recovered successfully`, 파괴적 빨강 아님)를 표시하고, 원본 Import run ID·recovery run ID 를 있으면 함께 노출하며 `Copy Run ID` 를 제공한다. Dry-run/Upload/Snapshot/Import 버튼은 모두 비활성.

## 5-2. Preparation 건너뛰기 (§5)

Step 1~3 영역에 `I already have a completed Increment ZIP` 보조 진입점을 두어 Step 4 로 이동할 수 있게 한다. Step 4 의 package/schema/hash/Baseline/precheck 검증은 어떤 경우에도 생략하지 않으며, Step 1~3 체크는 "사용자 확인"일 뿐 서버 검증으로 간주하지 않는다. 신규 사용자의 기본 진입은 Step 1.

## 5-3. Step 8 버튼 (§6)

`abd_ocs_import_logs` 를 목록으로 보여주는 화면이 코드베이스에 없음을 확인했다(참조처는 서버 함수뿐). 따라서 Step 8 에는 `Copy Run ID`, `Open ABD Raw Data`, `Technical result JSON` 만 제공한다. `View OCS Import Log` 는 BACKLOG 에 별도 화면 구축 항목으로 등재한다.

## 6. 활성화 조건

- Step 2 ← Step 1의 "I saved the Baseline ZIP on this computer." 체크
- Step 3 ← Step 2 체크박스 3종
- Step 4 ← Step 3 완료 확인 체크
- Step 5 ← 패키지 검증 + Storage 충돌 점검 + Dry-run 통과(blockers 0)
- Step 6 ← 업로드 실패 0 + 서버 검증 완료(verified = newAssetTotal)
- Step 7 ← 현재 패키지와 연결이 증명된 Snapshot 성공(§3 규칙)
- Step 8 ← Import 성공 + 항등식 전부 일치

기존 `blockers` 배열은 유지하되 **각 항목을 소속 Step에 배분**해 해당 단계 버튼 아래에만 사유를 표시한다.

## 7. 비고

- 안내 문구는 한국어 기본, 스펙에 영어로 명시된 버튼·완료 문구(`Choose Increment ZIP`, `All files were uploaded and verified successfully.` 등)는 원문 그대로 사용한다.
- 기존 버튼 나열형 화면은 단계 카드 배치로 대체되며 병행 노출하지 않는다(로직은 동일 controller 그대로).
- 실제 Baseline 생성·Upload·Snapshot·Import·복구는 실행하지 않는다.