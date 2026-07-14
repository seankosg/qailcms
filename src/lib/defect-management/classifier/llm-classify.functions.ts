import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ItemSchema = z.object({
  source_issue_no: z.string(),
  category: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  item: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  targets: z.array(z.enum(["defect_location", "main_trade", "sub_trade", "work_type"])).min(1),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(50),
});

export type LlmClassifyInput = z.infer<typeof InputSchema>;

export interface LlmClassifyResultItem {
  source_issue_no: string;
  defect_location: string | null;
  main_trade: string | null;
  sub_trade: string | null;
  work_type: string | null;
}

const SYSTEM_PROMPT = `당신은 건설 하자(Snag) 항목을 분류하는 엔진입니다. 각 항목의 category/type/item/description을 종합하여 targets 배열에 지정된 필드만 채웁니다.

대상 필드와 허용 값(다른 값 금지, 판별 불가 시 "To Be Confirmed"):
- defect_location: Ceiling | Floor | Wall | Door | Window | Staircase | Facade | Column | Beam
- work_type: Painting | Cleaning | Sealing | Alignment | Repair/Replace | Tiling/Stonework | Insulation | Cabling | Labeling | Install Missing

Main Trade / Sub Trade 계층 (Category family 아래에만 허용):

Electrical (Category ∈ Electrical, MEP-Electrical, MEP-ELV):
- Cable Containment / Tray/Ladder/Conduit
- Lighting / Light Fittings
- Power & Distribution / DB/Sockets/Wiring
- ELV & Fire Alarm / Devices/Labeling
- Electrical Services / General Electrical (기타)

Mechanical (Category ∈ Mechanical, MEP-Mechanical, Plumbing, Fire Fighting, Gas):
- HVAC / Ductwork/Grilles/AHU
- Piping / CHW/Drainage Piping
- Thermal Insulation / Pipe/Duct Insulation
- Plumbing & Sanitary / Sanitaryware/Fixtures
- Fire Protection / FF Equipment
- Mechanical Services / General Mechanical (기타)

Facade (Category = Facade):
- Facade Panels & Glazing / Panels/Glazing
- Facade Sealing / Gaskets/Weather Seal
- Facade Glazing / Glass Units
- Facade Works / General Facade (기타)

Architectural (Category ∈ Architectural, Structural, Quality, Acoustics, Marine):
- Painting / Wall/Floor Painting
- Doors & Ironmongery / Door/Frame/Ironmongery
- Ceiling / Gypsum/Suspended Ceiling
- Flooring / Tiling/Stone/Screed
- Wall Finishes / Plaster/Cladding/Stone
- Staircase & Balustrade / Steps/Handrail
- Joinery & Fitout / Cabinets/Mirrors
- Plumbing & Sanitary / Sanitaryware/Fixtures

규칙:
1. targets 배열에 없는 필드는 항상 null 로 반환.
2. targets 에 있는 필드는 반드시 위 목록의 값 또는 "To Be Confirmed" 로 반환.
3. main_trade 는 해당 항목 category 의 family 아래여야 하고, sub_trade 는 채택한 main_trade 하위여야 한다. 계층 위반 금지.
4. 확신이 없으면 임의 추측 없이 "To Be Confirmed".
5. 응답은 JSON 배열 items 만 포함하고, 각 원소는 { source_issue_no, defect_location, main_trade, sub_trade, work_type } 형식.`;

const ResponseSchema = z.object({
  items: z.array(z.object({
    source_issue_no: z.string(),
    defect_location: z.string().nullable(),
    main_trade: z.string().nullable(),
    sub_trade: z.string().nullable(),
    work_type: z.string().nullable(),
  })),
});

export const classifyDefectsWithLlm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<{ items: LlmClassifyResultItem[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY 미설정");

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const { generateText, Output, NoObjectGeneratedError } = await import("ai");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash-lite");

    const userPrompt = JSON.stringify({ items: data.items });

    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: ResponseSchema }),
        system: SYSTEM_PROMPT,
        prompt: `다음 항목들을 분류하세요. 각 항목의 targets 에 있는 필드만 실제 값으로 채우고 나머지는 null. JSON입니다:\n\n${userPrompt}`,
      });
      return { items: output.items };
    } catch (error: any) {
      if (NoObjectGeneratedError.isInstance?.(error)) {
        console.warn("[defect-classify] no-object", error?.message);
        // 폴백: 전부 TBC(=null) 반환 → 상위 로직이 TBD 로 채움
        return { items: data.items.map((i) => ({
          source_issue_no: i.source_issue_no,
          defect_location: null,
          main_trade: null,
          sub_trade: null,
          work_type: null,
        })) };
      }
      throw error;
    }
  });