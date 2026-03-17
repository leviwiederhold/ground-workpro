import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfileRecord = {
  full_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  timezone?: string | null;
  avatar_url?: string | null;
  appearance_preference?: string | null;
  notification_preferences?: Record<string, unknown> | null;
};

export function parseMissingColumn(message: string | undefined) {
  if (!message) return null;
  const quoted = message.match(/Could not find the '([^']+)' column/i);
  if (quoted?.[1]) return quoted[1];
  const relation = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (relation?.[1]) return relation[1];
  return null;
}

export function isMissingColumnError(message: string | undefined) {
  return /column|Could not find the/i.test(String(message || "")) && /does not exist|not find/i.test(String(message || ""));
}

export async function selectProfileColumns<T extends Record<string, unknown> = ProfileRecord>(
  supabase: SupabaseClient,
  userId: string,
  columns: string[]
) {
  const selectColumns = [...columns];
  let lastResult: { data: T | null; error: { message?: string } | null } | null = null;

  for (let attempt = 0; attempt < selectColumns.length; attempt += 1) {
    const result = await supabase
      .from("profiles")
      .select(selectColumns.join(", "))
      .eq("id", userId)
      .maybeSingle<T>();
    if (!result.error) return result;

    lastResult = result;
    const missingColumn = parseMissingColumn(result.error.message);
    if (!missingColumn || !selectColumns.includes(missingColumn)) {
      return result;
    }
    selectColumns.splice(selectColumns.indexOf(missingColumn), 1);
  }

  if (lastResult) return lastResult;
  return supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle<T>();
}

export async function upsertProfileColumns<T extends Record<string, unknown> = ProfileRecord>(params: {
  supabase: SupabaseClient;
  userId: string;
  payload: Record<string, unknown>;
  selectColumns: string[];
}) {
  const upsertPayload = { ...params.payload };
  let upsertError: { message?: string } | null = null;

  for (let attempt = 0; attempt < Object.keys(upsertPayload).length + 1; attempt += 1) {
    const result = await params.supabase.from("profiles").upsert(upsertPayload, { onConflict: "id" });
    if (!result.error) {
      upsertError = null;
      break;
    }

    const missingColumn = parseMissingColumn(result.error.message);
    if (!missingColumn || !(missingColumn in upsertPayload)) {
      upsertError = result.error;
      break;
    }

    delete upsertPayload[missingColumn];
    upsertError = result.error;
  }

  if (upsertError) {
    return {
      data: null as T | null,
      error: upsertError,
    };
  }

  return await selectProfileColumns<T>(params.supabase, params.userId, params.selectColumns);
}
