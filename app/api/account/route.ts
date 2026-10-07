import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { getAccountDeletionBlocker } from "@/lib/auth/accountDeletion";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({ confirmation: z.literal("DELETE") });

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Type DELETE to confirm account deletion." }, { status: 422 });
  }

  const supabase = await supabaseServer();
  const authResult = await supabase.auth.getUser();
  const user = authResult.data.user;
  if (authResult.error || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Account deletion is temporarily unavailable." }, { status: 503 });
  }

  const blocker = await getAccountDeletionBlocker(admin, user.id);
  if (blocker) {
    return NextResponse.json(
      {
        error: blocker,
        code: "account_deletion_blocked",
      },
      { status: 409 },
    );
  }

  const deletion = await admin.auth.admin.deleteUser(user.id, false);
  if (deletion.error) {
    return NextResponse.json({ error: deletion.error.message || "Account deletion failed." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
