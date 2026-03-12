import Link from "next/link";
import { redirect } from "next/navigation";
import { getCompanyId } from "@/lib/tenant/getCompanyId";
import { getSetupStatusForUser } from "@/lib/onboarding/setupFlow";

export default async function SetupPage() {
  let item: Awaited<ReturnType<typeof getSetupStatusForUser>>;
  try {
    const { supabase, companyId, userId, userEmail } = await getCompanyId();
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
            Complete the required onboarding steps before continuing to the main app.
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <ul className="space-y-3">
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
                    <Link
                      href={step.href}
                      className="inline-flex rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                    >
                      Open Step
                    </Link>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/setup" className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              Refresh Status
            </Link>
            <span className="text-xs text-gray-500">
              Setup stays active until all required steps are complete.
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
