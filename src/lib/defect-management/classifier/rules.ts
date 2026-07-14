/**
 * Snag 하자 자동 분류 규칙.
 * 출처: user-uploads/Snag_Trade_Classification_Prompt.md
 * 이 상수는 규칙 기반 분류와 LLM 계층 검증에 공동으로 사용된다.
 */

export const TBD = "To Be Confirmed" as const;

export type TradeFamily = "Electrical" | "Mechanical" | "Facade" | "Architectural";

/** Category → Trade family. 소문자 정규화된 키. 값이 없으면 폴백 판별 대상. */
export const CATEGORY_TO_FAMILY: Record<string, TradeFamily> = {
  electrical: "Electrical",
  "mep-electrical": "Electrical",
  "mep-elv": "Electrical",
  mechanical: "Mechanical",
  "mep-mechanical": "Mechanical",
  plumbing: "Mechanical",
  "fire fighting": "Mechanical",
  gas: "Mechanical",
  facade: "Facade",
  "façade": "Facade",
  architectural: "Architectural",
  structural: "Architectural",
  quality: "Architectural",
  acoustics: "Architectural",
  marine: "Architectural",
};

export interface TradeRule {
  keywords: string[];
  main_trade: string;
  sub_trade: string;
}

/** family 별 Main/Sub Trade 규칙. 상단부터 순차 매칭, 처음 매칭된 규칙 채택. */
export const TRADE_RULES: Record<TradeFamily, TradeRule[]> = {
  Electrical: [
    { keywords: ["cable ladder", "cable tray", "tray", "trunking", "conduit"], main_trade: "Cable Containment", sub_trade: "Tray/Ladder/Conduit" },
    { keywords: ["light", "luminaire"], main_trade: "Lighting", sub_trade: "Light Fittings" },
    { keywords: ["mdb", "socket", "power", "wiring", "ameter"], main_trade: "Power & Distribution", sub_trade: "DB/Sockets/Wiring" },
    { keywords: ["fire alarm", "detector", "label", "identification"], main_trade: "ELV & Fire Alarm", sub_trade: "Devices/Labeling" },
  ],
  Mechanical: [
    { keywords: ["duct", "hvac", "ahu", "ac grill", "air condition"], main_trade: "HVAC", sub_trade: "Ductwork/Grilles/AHU" },
    { keywords: ["chilled water", "pipe", "condensate", "drain", "rainwater"], main_trade: "Piping", sub_trade: "CHW/Drainage Piping" },
    { keywords: ["insulation"], main_trade: "Thermal Insulation", sub_trade: "Pipe/Duct Insulation" },
    { keywords: ["sanitary", "basin", "wc", "bath"], main_trade: "Plumbing & Sanitary", sub_trade: "Sanitaryware/Fixtures" },
    { keywords: ["hose reel", "sprinkler", "extinguisher", "fire stop"], main_trade: "Fire Protection", sub_trade: "FF Equipment" },
  ],
  Facade: [
    { keywords: ["opaque panel", "vision panel", "bemo", "uhpc", "stick system", "curtain wall", "aluminium glass", "panel"], main_trade: "Facade Panels & Glazing", sub_trade: "Panels/Glazing" },
    { keywords: ["gasket", "seal", "epdm"], main_trade: "Facade Sealing", sub_trade: "Gaskets/Weather Seal" },
    { keywords: ["glass"], main_trade: "Facade Glazing", sub_trade: "Glass Units" },
  ],
  Architectural: [
    { keywords: ["wall paint", "epoxy", "painting", "paint"], main_trade: "Painting", sub_trade: "Wall/Floor Painting" },
    { keywords: ["door", "shutter", "architrave", "frame"], main_trade: "Doors & Ironmongery", sub_trade: "Door/Frame/Ironmongery" },
    { keywords: ["ceiling", "soffit"], main_trade: "Ceiling", sub_trade: "Gypsum/Suspended Ceiling" },
    { keywords: ["floor", "tile", "marble", "ceramic", "nosing"], main_trade: "Flooring", sub_trade: "Tiling/Stone/Screed" },
    { keywords: ["wall", "acoustic", "gypsum", "cladding", "stone"], main_trade: "Wall Finishes", sub_trade: "Plaster/Cladding/Stone" },
    { keywords: ["stair", "handrail"], main_trade: "Staircase & Balustrade", sub_trade: "Steps/Handrail" },
    { keywords: ["vanity", "cabinet", "mirror", "joinery"], main_trade: "Joinery & Fitout", sub_trade: "Cabinets/Mirrors" },
    { keywords: ["sanitary"], main_trade: "Plumbing & Sanitary", sub_trade: "Sanitaryware/Fixtures" },
  ],
};

/** family fallback 도 실패했을 때 각 family의 "General" 값. */
export const FAMILY_GENERAL: Record<TradeFamily, { main_trade: string; sub_trade: string }> = {
  Electrical: { main_trade: "Electrical Services", sub_trade: "General Electrical" },
  Mechanical: { main_trade: "Mechanical Services", sub_trade: "General Mechanical" },
  Facade: { main_trade: "Facade Works", sub_trade: "General Facade" },
  Architectural: { main_trade: TBD, sub_trade: TBD },
};

export interface KeywordRule<V extends string> {
  keywords: string[];
  value: V;
}

export const LOCATION_RULES: KeywordRule<
  "Ceiling" | "Floor" | "Wall" | "Door" | "Window" | "Staircase" | "Facade" | "Column" | "Beam"
>[] = [
  { keywords: ["ceiling", "soffit", "bulkhead", "cornice"], value: "Ceiling" },
  { keywords: ["floor", "skirting", "nosing", "flooring"], value: "Floor" },
  { keywords: ["wall", "cladding", "partition"], value: "Wall" },
  { keywords: ["door", "shutter", "architrave", "frame", "ironmongery"], value: "Door" },
  { keywords: ["window", "vision panel", "glazing", "glass"], value: "Window" },
  { keywords: ["stair", "handrail", "balustrade"], value: "Staircase" },
  { keywords: ["facade", "opaque panel", "curtain wall", "stick system", "bemo", "uhpc"], value: "Facade" },
  { keywords: ["column"], value: "Column" },
  { keywords: ["beam"], value: "Beam" },
];

export const WORK_TYPE_RULES: KeywordRule<
  | "Painting"
  | "Cleaning"
  | "Sealing"
  | "Alignment"
  | "Repair/Replace"
  | "Tiling/Stonework"
  | "Insulation"
  | "Cabling"
  | "Labeling"
  | "Install Missing"
>[] = [
  { keywords: ["paint"], value: "Painting" },
  { keywords: ["stain", "clean", "debris", "dust", "patch"], value: "Cleaning" },
  { keywords: ["seal", "gasket", "epdm", "drop seal"], value: "Sealing" },
  { keywords: ["align", "level", "irregular"], value: "Alignment" },
  { keywords: ["crack", "dent", "scratch", "chip", "damage", "broken", "distort"], value: "Repair/Replace" },
  { keywords: ["tile", "grout", "stone", "marble"], value: "Tiling/Stonework" },
  { keywords: ["insulation"], value: "Insulation" },
  { keywords: ["cable", "conduit", "wiring"], value: "Cabling" },
  { keywords: ["label", "identification"], value: "Labeling" },
  { keywords: ["missing", "not installed", "not provided", "not fitted", "not completed"], value: "Install Missing" },
];

/** Category 문자열을 family 로 정규화. 매칭 실패 시 null. */
export function resolveFamily(category: string | null | undefined): TradeFamily | null {
  if (!category) return null;
  const norm = String(category).trim().toLowerCase();
  if (CATEGORY_TO_FAMILY[norm]) return CATEGORY_TO_FAMILY[norm];
  // 부분 매칭 폴백 — Category 라벨은 프로젝트별로 접미사가 붙는 경우가 많다.
  for (const [k, v] of Object.entries(CATEGORY_TO_FAMILY)) {
    if (norm.includes(k)) return v;
  }
  return null;
}

/** Main Trade 가 해당 family 아래인지 계층 검증. FAMILY_GENERAL 도 허용. */
export function isMainTradeInFamily(mainTrade: string, family: TradeFamily): boolean {
  if (mainTrade === TBD) return true;
  const rules = TRADE_RULES[family];
  if (rules.some((r) => r.main_trade === mainTrade)) return true;
  if (FAMILY_GENERAL[family].main_trade === mainTrade) return true;
  return false;
}

/** Sub Trade 가 지정 Main Trade 아래인지 계층 검증. */
export function isSubTradeInMain(subTrade: string, mainTrade: string, family: TradeFamily): boolean {
  if (subTrade === TBD) return true;
  const rules = TRADE_RULES[family];
  for (const r of rules) {
    if (r.main_trade === mainTrade && r.sub_trade === subTrade) return true;
  }
  if (FAMILY_GENERAL[family].main_trade === mainTrade && FAMILY_GENERAL[family].sub_trade === subTrade) return true;
  return false;
}

/** 4개 필드 이름. */
export const CLASSIFIER_FIELDS = ["defect_location", "main_trade", "sub_trade", "work_type"] as const;
export type ClassifierField = (typeof CLASSIFIER_FIELDS)[number];

/** 값이 "빈 값 또는 TBD" 인지 → 재분류 대상. */
export function isFieldEmpty(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  return s === "" || s === TBD;
}