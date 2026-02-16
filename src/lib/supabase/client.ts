import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

export function supabaseBrowser() {
  const { url, anonKey } = getSupabaseEnv();

  return createBrowserClient(
    url,
    anonKey
  );
}
