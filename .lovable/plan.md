## 목표
임포트 파일 카드의 "컬럼 선택" 버튼 옆에 **AI 분류 기능 활성/비활성 토글**을 추가합니다. 기본값은 **비활성화**이며, 비활성 상태에서는 LLM 기반 백그라운드 분류(`bulkClassifyDefects`) 호출을 건너뜁니다.

## 변경 사항

### 1) `src/contexts/DefectManagementImportContext.tsx`
- `DefectImportFile` 타입에 `aiClassifyEnabled: boolean` 필드 추가 (기본값 `false`, 파일 등록 시 초기화).
- 파일 상태 setter `setFileAiClassifyEnabled(fileId, enabled)`를 컨텍스트에 추가하고 export.
- 임포트 파이프라인에서 규칙 분류(`runRuleStage`)는 그대로 실행하되(즉시 반영되는 규칙 매칭 결과는 유지), **`f.aiClassifyEnabled === false`이면**:
  - `rowsNeedingBackgroundClassify` 수집 및 `bulkClassifyDefects` 백그라운드 호출을 스킵.
  - `classificationResult.llmRows`는 0으로 기록(뱃지에 "AI queued"가 나타나지 않도록).

### 2) `src/components/defect-management/import/DefectManagementImportPage.tsx`
- "컬럼 선택" 버튼 우측에 shadcn `Switch` + 라벨 "AI 분류" 배치.
- `checked = f.aiClassifyEnabled`, `onCheckedChange`로 `setFileAiClassifyEnabled(f.id, v)` 호출.
- `disabled` 조건은 컬럼 선택 버튼과 동일(`disabled || f.status === "parsing"`), 그리고 임포트 진행 중(`status === "importing"`)일 때도 잠금.
- 상위 `FileRow` props에 `aiClassifyEnabled`, `onToggleAiClassify` 전달.

## 동작 요약
| 상태 | 규칙 분류 | LLM 백그라운드 분류 |
|---|---|---|
| AI 분류 OFF (기본) | 실행 | **스킵** |
| AI 분류 ON | 실행 | 실행 |

기존의 게이트 로직(원본에 4개 필드가 이미 채워진 행 스킵)과 뱃지 표시(Classification skip / Rule classified / AI queued / AI updated / AI failed)는 그대로 유지됩니다.

## 검증
- `bunx tsgo --noEmit` 타입 체크 통과.
- 프리뷰에서 파일 첨부 후 토글 기본 OFF 확인, ON으로 전환 시에만 AI 분류 뱃지가 뜨는지 확인.
