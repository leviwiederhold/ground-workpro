import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalCompanyId } from "@/lib/tenant/getCompanyId";
import { getSetupStatusForUser } from "@/lib/onboarding/setupFlow";
import { SetupActionsClient } from "./SetupActionsClient";

export default async function SetupPage() {
  let item: Awaited<ReturnType<typeof getSetupStatusForUser>>;
  try {
    const { supabase, companyId, userId, userEmail } = await getOptionalCompanyId();
    item = await getSetupStatusForUser({
      supabase,
      companyId,
      userId,
      userEmail: String(userEmail ?? "").trim(),
    });
  } catch {
    redirect("/login");
  }

  if (item.is_complete) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">Finish Your Setup</h1>
          <p className="mt-2 text-sm text-gray-600">
            Complete the essentials, then finish the rest whenever you are ready.
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {item.required_steps.length > 0 ? (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Required Before Entering</h2>
              <ul className="mt-3 space-y-3">
                {item.required_steps.map((step) => (
                  <li key={step.key} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{step.label}</p>
                        <p className="mt-1 text-sm text-gray-600">{step.description}</p>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          step.completed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {step.completed ? "Completed" : "Required"}
                      </span>
                    </div>
                    {!step.completed && (
                      <div className="mt-3">
                        {!item.has_company && step.key === "complete_company_settings" ? (
                          <SetupActionsClient canSkipOptionalSteps={false} canCreateWorkspace />
                        ) : (
                          <Link
                            href={step.href}
                            className="inline-flex rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                          >
                            Open Step
                          </Link>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              No required setup items are blocking access. You can continue into the app and finish the optional steps later.
            </div>
          )}

          {item.optional_steps.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Optional For Now</h2>
              <ul className="mt-3 space-y-3">
                {item.optional_steps.map((step) => (
                  <li key={step.key} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{step.label}</p>
                        <p className="mt-1 text-sm text-gray-600">{step.description}</p>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          step.completed ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {step.completed ? "Completed" : "Optional"}
                      </span>
                    </div>
                    {!step.completed && (
                      <div className="mt-3">
                        <Link
                          href={step.href}
                          className="inline-flex rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Open Step
                        </Link>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <SetupActionsClient
            canSkipOptionalSteps={item.required_complete && item.optional_steps.some((step) => !step.completed)}
            canCreateWorkspace={false}
          />
        </section>
      </div>
    </main>
  );
}
