import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserIdentity } from "@/lib/user/identity";

export default async function AccountSettingsPage() {
  let identity: Awaited<ReturnType<typeof getCurrentUserIdentity>>;
  try {
    identity = await getCurrentUserIdentity();
  } catch {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">Account Settings</h1>
          <p className="mt-2 text-sm text-gray-600">
            Basic account information is live. Additional preferences can be added here.
          </p>
          <div className="mt-6 grid gap-3 text-sm">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-gray-500">Account Name</p>
              <p className="font-medium text-gray-900">{identity.resolvedName}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-gray-500">Email</p>
              <p className="font-medium text-gray-900 break-all">{identity.email || "-"}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <Link href="/" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
