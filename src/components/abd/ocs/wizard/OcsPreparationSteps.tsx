import { Checkbox } from "@/components/ui/checkbox";

/** 로컬 Codex Skill 과 QAIL CMS 의 업무 책임 구분 안내 */
export function OcsResponsibilityCard() {
  return (
    <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
      <div>
        <div className="text-xs font-semibold">Local Codex Skill 담당</div>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          <li>• 최신 Baseline 검증</li>
          <li>• 신규·개정 OCS Excel 비교</li>
          <li>• 변경 없음 · 신규 · 개정 판정</li>
          <li>• 코멘트 원자화 · 기존 Comment ID 재사용</li>
          <li>• Contractor Response 연결 · 이미지 연결</li>
          <li>• 검토 대상 제시 · 최종 Increment ZIP 생성</li>
        </ul>
      </div>
      <div>
        <div className="text-xs font-semibold">QAIL CMS 담당</div>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          <li>• 완성된 Increment ZIP 구조 · hash 검증</li>
          <li>• 운영 DB 와 Dry-run 비교</li>
          <li>• 신규 이미지 · Source Excel 업로드</li>
          <li>• 서버 SHA-256 · 크기 검증</li>
          <li>• 사전 Snapshot 생성 · 운영 DB Import</li>
          <li>• 최종 무결성 검증과 로그 보존</li>
        </ul>
      </div>
      <p className="text-[11px] text-muted-foreground md:col-span-2">
        QAIL CMS 는 원본 Excel 을 직접 해석하지 않으며, 코멘트·Response·이미지의 의미를 다시
        추론하지 않습니다.
      </p>
    </div>
  );
}

export function CheckItem({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <span>{label}</span>
    </label>
  );
}

/** Step 2 — 신규·개정 OCS Excel 준비 (업로드 없음) */
export function Step2PrepareFiles({
  checks,
  onChange,
}: {
  checks: [boolean, boolean, boolean];
  onChange: (i: 0 | 1 | 2, v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        <li>• DAR 에서 새로 받은 OCS Excel 만 별도 폴더에 모읍니다.</li>
        <li>• 신규 파일과 Revision 이 변경된 파일만 포함합니다.</li>
        <li>• 기존 OCS 전체 298 개를 다시 넣지 않습니다.</li>
        <li>• 파일명을 임의로 변경하지 않고, Excel 내용도 직접 수정하지 않습니다.</li>
        <li>
          • Excel 잠금 파일 <code>~$...xlsx</code> 는 제외합니다.
        </li>
        <li>• OneDrive/SharePoint 복사가 끝난 후 작업합니다.</li>
        <li>• 원본 Excel 폴더 안에 Review workspace 를 만들지 않습니다.</li>
      </ul>
      <div className="space-y-2 rounded-md border p-3">
        <CheckItem
          checked={checks[0]}
          onChange={(v) => onChange(0, v)}
          label="I included only new or revised OCS Excel files."
        />
        <CheckItem
          checked={checks[1]}
          onChange={(v) => onChange(1, v)}
          label="I did not rename or modify the DAR files."
        />
        <CheckItem
          checked={checks[2]}
          onChange={(v) => onChange(2, v)}
          label="I know the folder location on this computer."
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        이 단계에서는 Excel 을 QAIL CMS 에 업로드하지 않습니다. 체크는 사용자 확인 기록일 뿐이며,
        실제 검증은 Step 4 서버 관문에서 수행합니다.
      </p>
    </div>
  );
}

/** Step 3 — 로컬 qail-ocs-increment Skill 로 증분 패키지 생성 */
export function Step3BuildPackage({
  confirmed,
  onConfirm,
}: {
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Baseline 비교, 코멘트 분류, ID 재사용, Response 와 이미지 연결은 로컬{" "}
        <code>qail-ocs-increment</code> Skill 이 수행합니다.
      </p>
      <div className="rounded-md border p-3">
        <div className="text-xs font-semibold">필수 입력</div>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          <li>
            • Step 1 의 최신 <code>OCS_Baseline_*.zip</code>
          </li>
          <li>• Step 2 의 신규·개정 Excel 폴더</li>
          <li>• 쓰기 가능한 Review/output 폴더</li>
        </ul>
      </div>
      <div className="rounded-md border p-3">
        <div className="text-xs font-semibold">Skill 정본 흐름</div>
        <pre className="mt-1 overflow-auto rounded bg-muted/50 p-2 text-[11px]">
          {`doctor
verify-baseline
plan
prepare
extract
review
package`}
        </pre>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="text-xs font-semibold">Windows 사전 확인</div>
          <pre className="mt-1 overflow-auto rounded bg-muted/50 p-2 text-[11px]">
            {`scripts\\ocs_increment.cmd doctor`}
          </pre>
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            <li>• Python 3.10 이상 (가능하면 py -3 launcher)</li>
            <li>• 긴 OCS 파일명을 고려해 짧은 작업경로 권장</li>
            <li>• 공백·한글 경로는 항상 따옴표 처리</li>
            <li>• Review workspace 를 Excel 입력 폴더 안에 만들지 않음</li>
            <li>• OneDrive/SharePoint 동기화 중 실행 금지</li>
          </ul>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs font-semibold">macOS / Linux 사전 확인</div>
          <pre className="mt-1 overflow-auto rounded bg-muted/50 p-2 text-[11px]">
            {`python3 scripts/ocs_increment.py doctor`}
          </pre>
          <p className="mt-1 text-[11px] text-muted-foreground">
            상세 명령은 설치된 <code>qail-ocs-increment/SKILL.md</code> 를 정본으로 사용합니다. 이
            화면은 경로나 명령을 추측하지 않습니다.
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="text-xs font-semibold">Plan 결과 확인 항목</div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            unchanged · new · revised · stale · same-revision-changed · actionable · blockers.
            변경이 없는 파일은 다시 추출하지 않습니다.
          </p>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs font-semibold">Review 대상</div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            <li>
              • <code>reviewed/identity_audit.json</code>
            </li>
            <li>
              • <code>atomic.draft.json</code>
            </li>
            <li>
              • <code>response_mapping.draft.json</code>
            </li>
            <li>
              • <code>policy.draft.json</code>
            </li>
          </ul>
          <p className="mt-1 text-[11px] text-destructive">
            identity blockers · closed response review blockers · images needs review 중 하나라도
            남으면 package 를 생성하지 마십시오.
          </p>
        </div>
      </div>
      <div className="rounded-md border p-3 text-[11px] text-muted-foreground">
        최종 파일: <code>OCS_Increment_&lt;YYYYMMDD&gt;_&lt;seq&gt;.zip</code>
        <div className="mt-1">
          Do not extract or modify the generated ZIP. Return to QAIL CMS and select it in Step 4.
        </div>
      </div>
      <div className="rounded-md border p-3">
        <CheckItem
          checked={confirmed}
          onChange={onConfirm}
          label="The local tool completed successfully and created the Increment ZIP."
        />
      </div>
    </div>
  );
}