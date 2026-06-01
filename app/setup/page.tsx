import { redirect } from "next/navigation";
import { getOptionalCompanyId } from "@/lib/tenant/getCompanyId";
import { getSetupStatusForUser, loadProfileForSetup } from "@/lib/onboarding/setupFlow";
import SetupWizardClient from "./SetupWizardClient";

export const dynamic = "force-dynamic";

function splitName(fullName: string): { first: string; last: string } {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export default async function SetupPage() {
  let prefill;
  try {
    const { supabase, companyId, userId, userEmail } = await getOptionalCompanyId();
    const status = await getSetupStatusForUser({
      supabase,
      companyId,
      userId,
      userEmail: String(userEmail ?? "").trim(),
    });

    if (status.is_complete) {
      redirect("/");
    }

    const profile = await loadProfileForSetup(supabase, userId);
    const email = String(userEmail ?? "").trim().toLowerCase();
    const rawName = String((profile as Record<string, unknown> | null)?.full_name ?? "").trim();
    const displayName = rawName && rawName.toLowerCase() !== email ? rawName : "";
    const { first, last } = splitName(displayName);

    // Employee's own job title may already be set from their invite.
    let inviteJobTitle = String((profile as Record<string, unknown> | null)?.job_title ?? "").trim();
    let emergencyContact = "";
    if (companyId) {
      let emp = await supabase
        .from("employees")
        .select("job_title, emergency_contact")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (emp.error && /emergency_contact|job_title/i.test(emp.error.message || "")) {
        emp = await supabase
          .from("employees")
          .select("job_title")
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle();
      }
      if (!emp.error && emp.data) {
        inviteJobTitle = inviteJobTitle || String((emp.data as Record<string, unknown>).job_title ?? "").trim();
        emergencyContact = String((emp.data as Record<string, unknown>).emergency_contact ?? "").trim();
      }
    }

    let company: { name: string; phone: string; address: string; timezone: string } | null = null;
    if (status.role === "admin" && companyId) {
      let companyRow = await supabase
        .from("companies")
        .select("name, phone, address, timezone")
        .eq("id", companyId)
        .maybeSingle();
      if (companyRow.error) {
        companyRow = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
      }
      const c = (companyRow.data ?? {}) as Record<string, unknown>;
      company = {
        name: String(c.name ?? "").trim(),
        phone: String(c.phone ?? "").trim(),
        address: String(c.address ?? "").trim(),
        timezone: String(c.timezone ?? "").trim(),
      };
    }

    prefill = {
      role: status.role === "admin" ? ("owner" as const) : ("employee" as const),
      hasCompany: status.has_company,
      firstName: first,
      lastName: last,
      phone: String((profile as Record<string, unknown> | null)?.phone ?? "").trim(),
      jobTitle: inviteJobTitle,
      timezone: String((profile as Record<string, unknown> | null)?.timezone ?? "").trim(),
      emergencyContact,
      company,
    };
  } catch {
    redirect("/login");
  }

  return <SetupWizardClient prefill={prefill} />;
}
