/**
 * 임포트 실패/제외 사유를 사용자가 이해할 수 있는 자연어 설명과
 * "어떻게 해야 하는지" 조치 안내로 변환한다. (표시 전용, 로직 영향 없음)
 */
export interface ReasonGuide {
  /** 사유 한 줄 제목 */
  title: string;
  /** 왜 이런 일이 생겼는지 */
  what: string;
  /** 사용자가 해야 할 조치 */
  fix: string;
}

const REASONS: Record<string, ReasonGuide> = {
  DATE_RANGE_INVALID: {
    title: "날짜 값이 허용 범위를 벗어났습니다",
    what: "엑셀의 날짜 칸에 실제 날짜가 아닌 값(예: 숫자 0, 1900년, 2100년 이후, 텍스트 메모)이 들어 있습니다.",
    fix: "해당 행의 날짜 칸을 확인해 실제 날짜(YYYY-MM-DD)로 고치거나 비워 두고, 파일을 다시 올리세요.",
  },
  WORK_TYPE_INVALID: {
    title: "Work Type 값이 정해진 목록에 없습니다",
    what: "Work Type 칸에 시스템이 인정하는 범주 밖의 값이 적혀 있습니다(오타·줄임말·자유 입력).",
    fix: "Work Type 칸을 드롭다운에 있는 정식 명칭으로 바꾼 뒤 다시 올리세요.",
  },
  SCOPE_DENIED_PERMISSION: {
    title: "이 행을 올릴 권한이 없습니다",
    what: "해당 행이 속한 팀/공종에 대해 회원님 계정에 임포트 권한이 부여되어 있지 않습니다.",
    fix: "본인 권한 범위의 행만 남긴 파일로 다시 올리거나, 관리자에게 해당 범위의 Import 권한을 요청하세요.",
  },
  SCOPE_FILTERED_MINE: {
    title: "본인 담당 과업이 아니어서 제외되었습니다",
    what: "회원님 계정은 본인이 PIC 또는 Engineer 로 지정된 행만 반영할 수 있습니다.",
    fix: "담당자 칸(PIC/ENG)에 본인 이름이 정확히 적혀 있는지 확인하세요. 남의 과업이라면 해당 담당자가 올려야 합니다.",
  },
  SCOPE_NO_TEAM: {
    title: "팀을 판단할 수 없어 제외되었습니다",
    what: "파일의 팀 열이 비어 있고, 회원님 프로필에도 팀이 설정되어 있지 않아 어느 팀 데이터인지 확정할 수 없습니다.",
    fix: "파일의 Team 열을 채우거나, 관리자에게 내 프로필의 팀 설정을 요청한 뒤 다시 올리세요.",
  },
  DUPLICATE_TASK_NO: {
    title: "같은 Task No 가 파일 안에 여러 번 있습니다",
    what: "동일한 Task No 행이 중복되어 있어 맨 앞 1건만 반영하고 나머지는 제외했습니다.",
    fix: "엑셀에서 Task No 중복을 제거하고, 실제로 다른 과업이라면 Task No 를 서로 다르게 부여해 다시 올리세요.",
  },
  COLUMN_UNMAPPED: {
    title: "인식하지 못한 열의 값은 반영되지 않았습니다",
    what: "열 제목이 시스템 항목과 연결되지 않았거나, 값의 형태가 항목 정의와 달라 해당 열이 임포트에서 제외되었습니다.",
    fix: "열 제목을 표준 명칭으로 바꾸거나, 관리자에게 해당 열 제목을 별칭(Mapping)으로 등록해 달라고 요청하세요.",
  },
  UPSERT_FAILED: {
    title: "데이터 저장 중 오류가 발생했습니다",
    what: "행 저장 단계에서 데이터베이스가 값을 거부했습니다(형식 불일치 또는 제약 위반).",
    fix: "Detail 의 메시지를 확인해 해당 칸 값을 고친 뒤 다시 올리세요. 반복되면 이 로그 화면을 캡처해 관리자에게 전달하세요.",
  },
  // PostgreSQL 오류 코드
  "23505": {
    title: "이미 있는 값과 중복됩니다",
    what: "고유해야 하는 값(예: Task No)이 이미 등록된 값과 같습니다.",
    fix: "중복된 Task No 를 수정하거나, 기존 항목을 수정할 목적이라면 동일 공종(Discipline)으로 올렸는지 확인하세요.",
  },
  "23502": {
    title: "필수 값이 비어 있습니다",
    what: "반드시 있어야 하는 칸(예: Task No, Team)이 비어 있습니다.",
    fix: "빈 칸을 채운 뒤 다시 올리세요.",
  },
  "23503": {
    title: "연결된 기준 정보가 없습니다",
    what: "입력한 값과 짝이 되는 기준 정보(팀·공종·마스터 코드 등)가 시스템에 등록되어 있지 않습니다.",
    fix: "값의 철자를 확인하거나, 관리자에게 해당 기준 정보 등록을 요청하세요.",
  },
  "22P02": {
    title: "값의 형식이 맞지 않습니다",
    what: "숫자 칸에 문자, 날짜 칸에 텍스트처럼 형식이 다른 값이 들어 있습니다.",
    fix: "해당 칸을 올바른 형식으로 바꾼 뒤 다시 올리세요(진도율은 숫자, 날짜는 날짜 형식).",
  },
  "42501": {
    title: "권한이 없어 저장이 거부되었습니다",
    what: "현재 계정 권한으로는 이 데이터를 저장할 수 없습니다.",
    fix: "관리자에게 해당 팀/공종의 Import 권한을 요청하세요.",
  },
  "57014": {
    title: "처리 시간이 초과되었습니다",
    what: "한 번에 처리한 데이터 양이 많아 서버가 작업을 중단했습니다.",
    fix: "파일을 여러 개로 나누어(예: 1,000행 단위) 다시 올리세요.",
  },
  __CANCELLED__: {
    title: "사용자가 임포트를 중단했습니다",
    what: "진행 중이던 임포트가 취소되었습니다.",
    fix: "필요하면 파일을 다시 올려 처음부터 진행하세요.",
  },
};

/** 배치 요약(exclusions)의 키를 자연어로 설명 */
const EXCLUSIONS: Record<string, ReasonGuide> = {
  excluded_by_permission: REASONS.SCOPE_DENIED_PERMISSION,
  excluded_by_scope: REASONS.SCOPE_FILTERED_MINE,
  excluded_no_team: REASONS.SCOPE_NO_TEAM,
  excluded_unmapped_fields: REASONS.COLUMN_UNMAPPED,
  duplicates: REASONS.DUPLICATE_TASK_NO,
  skipped_by_policy: {
    title: "정책상 건너뛴 행",
    what: "잠금(Locked)되었거나 상위에서 자동 계산되는 값이라 덮어쓰지 않았습니다.",
    fix: "값을 꼭 바꿔야 한다면 해당 행의 잠금을 해제하거나 화면에서 직접 수정하세요.",
  },
  rolled_up: {
    title: "상위 과업으로 자동 집계된 행",
    what: "하위 과업 값으로 상위(Main) 과업 값이 자동 계산되어 파일 값 대신 계산값이 쓰였습니다.",
    fix: "조치가 필요 없습니다. 상위 값을 바꾸려면 하위 과업 값을 수정하세요.",
  },
  renumbered: {
    title: "행 번호가 다시 매겨진 행",
    what: "정렬 순서를 맞추기 위해 시스템이 순번을 재부여했습니다.",
    fix: "조치가 필요 없습니다.",
  },
  resolved_by_decision: {
    title: "사용자가 선택해 처리한 행",
    what: "임포트 중 확인 창에서 회원님이 고른 방식대로 처리되었습니다.",
    fix: "조치가 필요 없습니다.",
  },
  unclassified: {
    title: "사유가 분류되지 않은 행",
    what: "파싱 행수와 반영·제외 행수가 맞지 않아 남은 차이입니다.",
    fix: "이 화면을 캡처해 관리자에게 전달하세요. 원인 확인이 필요합니다.",
  },
};

export function describeReason(code?: string | null): ReasonGuide | null {
  if (!code) return null;
  return REASONS[code] ?? REASONS[code.toUpperCase()] ?? null;
}

export function describeExclusion(key: string): ReasonGuide | null {
  return EXCLUSIONS[key] ?? null;
}

/** 사유 코드를 짧은 한국어 라벨로 (없으면 원래 코드) */
export function reasonLabel(code?: string | null): string {
  return describeReason(code)?.title ?? code ?? "—";
}

/** 배치 상태를 사람이 읽는 한 줄 요약으로 */
export function batchStatusSummary(status: string): string {
  switch (status) {
    case "failed":
      return "이 파일은 반영되지 않았습니다. 아래 사유를 고친 뒤 같은 파일을 다시 올리면 됩니다.";
    case "partial":
      return "일부 행만 반영되었습니다. 아래 제외 사유를 확인하고, 해당 행만 고쳐서 다시 올리세요.";
    case "rolled_back":
      return "이 임포트는 되돌려졌습니다. 반영되었던 변경은 모두 취소된 상태입니다.";
    default:
      return "";
  }
}
