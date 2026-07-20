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
  | "hdec_pic"
  | "hdec_eng"
  | "subcontractor"
  | "subsub"
  | "guest";

/**
 * 권한 rank. admin=100, superuser=90, d_superuser=80(전체 편집 승격),
 * senior_user=70, user=50, super_guest=30, guest=10.
 */
export const ROLE_RANK: Record<AppRole, number> = {
  admin: 100,
  superuser: 90,
  d_superuser: 80,
  senior_user: 70,
  user: 50,
  super_guest: 30,
  guest: 10,
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  superuser: "Super User",
  senior_user: "Senior User",
  user: "User",
  super_guest: "Super Guest",
  guest: "Guest",
  d_superuser: "D.Superuser",
};

export const USER_TYPE_LABELS: Record<UserType, string> = {
  admin: "Admin",
  pm_pd: "PM/PD",
  hdec: "HDEC (Legacy)",
  hdec_pic: "HDEC PIC",
  hdec_eng: "HDEC ENG",
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