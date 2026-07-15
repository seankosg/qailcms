export type AppRole =
  | "admin"
  | "superuser"
  | "senior_user"
  | "user"
  | "super_guest"
  | "guest"
  | "d_superuser";

export type UserType =
  | "admin"
  | "pm_pd"
  | "hdec"
  | "subcontractor"
  | "subsub"
  | "guest";

/**
 * 권한 rank. admin=100, superuser=90, senior_user=70, user=50,
 * super_guest=30, guest=10.  d_superuser 는 별도 축(team 스코프)이라
 * rank 0 으로 두고 hasRank 비교에서 제외한다.
 */
export const ROLE_RANK: Record<AppRole, number> = {
  admin: 100,
  superuser: 90,
  senior_user: 70,
  user: 50,
  super_guest: 30,
  guest: 10,
  d_superuser: 0,
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  superuser: "Super User",
  senior_user: "Senior User",
  user: "User",
  super_guest: "Super Guest",
  guest: "Guest",
  d_superuser: "D-Super User",
};

export const USER_TYPE_LABELS: Record<UserType, string> = {
  admin: "Admin",
  pm_pd: "PM/PD",
  hdec: "HDEC",
  subcontractor: "Subcontractor",
  subsub: "Sub-Sub",
  guest: "Guest",
};

/** SHAW 기준: 영문+숫자 조합, 6자 이상. */
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;
export const PASSWORD_HINT = "영문과 숫자를 포함하여 6자 이상 입력하세요.";
export const DEFAULT_PASSWORD = "Qail@2026!";

export const FAKE_EMAIL_DOMAIN = "qail.local";

export function loginIdToEmail(loginId: string): string {
  return `${loginId.trim().toLowerCase()}@${FAKE_EMAIL_DOMAIN}`;
}

export const ALL_APP_ROLES: AppRole[] = [
  "admin",
  "superuser",
  "senior_user",
  "user",
  "super_guest",
  "guest",
  "d_superuser",
];