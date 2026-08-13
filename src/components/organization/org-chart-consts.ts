/** 조직도 직책·직급 프리셋. 직책(duty)과 직급(rank)은 분리 관리한다. */
export const DUTY_OPTIONS = [
  "PD",
  "팀장",
  "파트장",
  "팀원",
] as const;

/** 직급 서열 — 값이 작을수록 상위. 같은 계층 내 정렬에 사용. */
export const RANK_OPTIONS: { title: string; level: number }[] = [
  { title: "상무", level: 10 },
  { title: "담당임원", level: 15 },
  { title: "수석매니저", level: 20 },
  { title: "책임매니저", level: 30 },
  { title: "매니저", level: 40 },
  { title: "선임", level: 50 },
  { title: "사원", level: 60 },
];

export function levelOfRank(title: string | null | undefined): number | null {
  if (!title) return null;
  return RANK_OPTIONS.find((r) => r.title === title)?.level ?? null;
}

export interface OrgPic {
  id: string;
  name: string;
  is_active: boolean;
  merged_into_id: string | null;
  duty_title: string | null;
  rank_title: string | null;
  rank_level: number | null;
  team_code: string | null;
  parent_pic_id: string | null;
  sort_order: number;
}