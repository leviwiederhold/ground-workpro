import { redirect } from "next/navigation";
import { getOptionalCompanyId } from "@/lib/tenant/getCompanyId";
import { getSetupStatusForUser, loadProfileForSetup } from "@/lib/onboarding/setupFlow";
import { getCompanyBillingStatus } from "@/lib/billing/isCompanySubscriptionActive";
import { SessionRecoveryScreen } from "@/app/components/auth/SessionRecoveryScreen";
import SetupWizardClient from "./SetupWizardClient";

export const dynamic = "force-dynamic";

function splitName(fullName: string): { first: string; last: string } {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export default async function SetupPage() {
  // 1. Resolve auth/tenant. getOptionalCompanyId returns companyId:null for an
  //    authenticated user without a workspace yet (e.g. brand-new OAuth owner),
  //    and only throws when NOT authenticated. So a thrown error here = signed
  //    out -> /login. An AUTHENTICATED user is never redirected to /login.
  let supabase: Awaited<ReturnType<typeof getOptionalCompanyId>>["supabase"];
  let companyId: string | null;
  let userId: string;
  let userEmail: string;
  try {
    const resolved = await getOptionalCompanyId();
    supabase = resolved.supabase;
    companyId = resolved.companyId;
    userId = resolved.userId;
    userEmail = String(resolved.userEmail ?? "").trim();
  } catch {
    return <SessionRecoveryScreen nextPath="/setup" />;
  }

  // 2. Compute onboarding status (shared helper — single source of truth).
  const status = await getSetupStatusForUser({
    supabase,
    companyId,
    userId,
    userEmail,
  });

  // 3. Owner gate: a company OWNER may only reach /setup once they have an
  //    active trial/subscription. If they have no workspace yet, or their
  //    company has no active/trialing subscription, send them to "/" where the
  //    OwnerTrialGate starts Stripe checkout. Invited employees (non-owners)
  //    are never gated on Stripe here — their access follows company state.
  //    (redirect() is outside try/catch so NEXT_REDIRECT isn't swallowed.)
  const isOwner = status.role === "admin";
  if (isOwner) {
    if (!companyId) {
      redirect("/");
    }
    const billing = await getCompanyBillingStatus(supabase, companyId);
    if (!billing.is_active) {
      redirect("/");
    }
  }

  // 4. Completed users leave setup.
  if (status.is_complete) {
    redirect("/");
  }

  // 4. Build prefill. Any data error here must keep the AUTHENTICATED user on
  //    /setup (never /login), so fall back to a minimal prefill.
  let prefill;
  try {
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
    // Authenticated but prefill failed — keep the user on /setup with a minimal
    // prefill instead of bouncing to /login.
    prefill = {
      role: status.role === "admin" ? ("owner" as const) : ("employee" as const),
      hasCompany: status.has_company,
      firstName: "",
      lastName: "",
      phone: "",
      jobTitle: "",
      timezone: "",
      emergencyContact: "",
      company: null,
    };
  }

  return <SetupWizardClient prefill={prefill} />;
}
