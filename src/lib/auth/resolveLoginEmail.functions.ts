import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const resolveLoginEmail = createServerFn({ method: "POST" })
  .inputValidator((input: { loginId: string }) => input)
  .handler(async ({ data }) => {
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { data: email, error } = await supabase.rpc("resolve_login_email", {
      _login_id: data.loginId,
    });
    if (error) throw new Error(error.message);
    if (!email) throw new Error("존재하지 않거나 비활성 계정입니다.");
    return { email: email as string };
  });