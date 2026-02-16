import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await supabaseServer();

  // Get current user
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = userData.user;

  // 1) Ensure profile exists
  await supabase.from("profiles").upsert({
    id: user.id,
    full_name: user.email,
  });

  // 2) Create company
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({ name: "My First Company" })
    .select()
    .single();

  if (companyError) {
    return NextResponse.json({ error: companyError.message }, { status: 400 });
  }

  // 3) Create membership as admin
  const { error: membershipError } = await supabase.from("memberships").insert({
    company_id: company.id,
    user_id: user.id,
    role: "admin",
  });

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, company });
}

