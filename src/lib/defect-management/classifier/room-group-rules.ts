/**
 * SM 임포트 — location_raw 기반 room_group 자동채움 (1계층 조회 + 2계층 규칙)
 *
 * 정책 (2026-08-05 승인):
 * - 표기 정본은 코드 상수(`ROOM_GROUP_ORDER`) 표기로 정규화해 적재한다.
 * - Reference 가 두 값으로 갈리는 8키(`ROOM_GROUP_CONFLICT`)는 자동채움하지 않는다.
 * - LLM 3계층은 미채용. 규칙 미매칭은 BOH 기본값으로 떨어진다.
 * - 실행 위치: SM 임포트의 AI 분류 토글이 켜져 있을 때만.
 *
 * 우선순위: 엑셀 원본값 → 기존 DB값 → 1계층(조회) → 2계층(규칙) → BOH
 */
import { ROOM_GROUP_CONFLICT, ROOM_GROUP_EXACT, normalizeLocationKey } from "./room-group-lookup";

/** Reference 어휘 → 코드 상수 표기 */
const CANON: Record<string, string> = {
  BOH: "BOH",
  FOH: "FOH",
  TENANT: "TENANT",
  STAIRCASE: "STAIRCASE",
  LIFT: "LIFT",
  CORRIDOR: "CORRIDOR",
  "STAIR-1": "STAIR-1",
  "STAIR-2": "STAIR-2",
  "CARPARK/ RAMP": "CARPARK / RAMP",
  "FOH (MAIN LOBBY)": "Main Lobby",
  TERRACE: "Terrace",
};

function canon(v: string): string | null {
  return CANON[v.trim().toUpperCase()] ?? null;
}

const TENANT_NAMES = new Set([
  "OFFICE",
  "LOW OFFICE",
  "MID OFFICE",
  "EXECUTIVE OFFICE",
  "OWNER OFFICE",
  "BUSINESS CENTRE",
]);

const CARPARK_NAMES = new Set([
  "CAR PARKING",
  "CAR RAMP",
  "VIP CAR RAMP",
  "VIP DROP OFF",
  "SERVICE CIRCULATION WAY",
  "STAFF CIRCULATION WAY",
]);

const TOWER_FOH_NAMES = new Set([
  "LOBBY",
  "LOBBY 2",
  "LOBBY 3",
  "VIP LOBBY",
  "WC",
  "WC(1)",
  "WC(2)",
  "WC(F)",
  "WC(M)",
  "ACCESSIBLE WC(F)",
  "ACCESSIBLE WC(M)",
  "WC LOBBY(1)",
  "WC LOBBY(2)",
  "TOILET(F)",
  "TOILET(M)",
  "PRAYER ROOM(F)",
  "PRAYER ROOM(M)",
  "PANTRY 1",
  "PANTRY 2",
]);

/** 2계층 — 규칙 10개 + BOH 기본값. Reference 496키를 오차 0으로 재현한다. */
export function ruleStage(key: string): string {
  const tower = key.startsWith("T-");
  const podiumN = /^P([1-4])-/.test(key);
  const podium = key.startsWith("P-");
  const name = key.replace(/^(T-|P-|P[1-4]-)/, "").trim();

  if (tower && /^(FL|PL|SL)\s*\d+$/.test(name)) return "LIFT"; // 1
  if (tower && name === "STAIR 1") return "STAIR-1"; // 2
  if (tower && name === "STAIR 2") return "STAIR-2"; // 3
  if (podiumN && name.startsWith("STAIR")) return "STAIRCASE"; // 4
  if (podiumN && name === "LOBBY") return "FOH (MAIN LOBBY)"; // 5
  if (TENANT_NAMES.has(name) || /^RETAIL\s*\d+$/.test(name)) return "TENANT"; // 6
  if (podium && /^CORRIDOR [2-9]$/.test(name)) return "CORRIDOR"; // 7
  if (name === "TERRACE") return "TERRACE"; // 8
  if (CARPARK_NAMES.has(name)) return "CARPARK/ RAMP"; // 9
  if (tower && TOWER_FOH_NAMES.has(name)) return "FOH"; // 10
  return "BOH";
}

/**
 * location_raw → room_group (코드 상수 표기).
 * 모호 8키이거나 location_raw 가 비면 null(자동채움 안 함).
 */
export function resolveRoomGroup(locationRaw: string | null | undefined): string | null {
  const key = normalizeLocationKey(locationRaw);
  if (!key) return null;
  if (key in ROOM_GROUP_CONFLICT) return null;
  const exact = ROOM_GROUP_EXACT[key];
  if (exact) return canon(exact);
  return canon(ruleStage(key));
}
