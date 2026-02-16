import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getSession();

    return NextResponse.json({
      ok: true,
      hasSession: !!data?.session,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        hasSession: false,
      },
      { status: 500 }
    );
  }
}
