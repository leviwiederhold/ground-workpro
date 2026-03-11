import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserIdentity } from "@/lib/user/identity";

export default async function MyProfilePage() {
  let identity: Awaited<ReturnType<typeof getCurrentUserIdentity>>;
  try {
    identity = await getCurrentUserIdentity();
  } catch {
    redirect("/login");
  }

  const showEmailRow =
    Boolean(identity.email) &&
    identity.email.trim().toLowerCase() !== identity.resolvedName.trim().toLowerCase();

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">My Profile</h1>
          <p className="mt-2 text-sm text-gray-600">
            Profile details used across the app for display and messaging.
          </p>
          <div className="mt-6 space-y-3 text-sm">
            <div>
              <p className="text-gray-500">Name</p>
              <p className="font-medium text-gray-900">{identity.resolvedName}</p>
            </div>
            {showEmailRow && (
              <div>
                <p className="text-gray-500">Email</p>
                <p className="font-medium text-gray-900 break-all">{identity.email}</p>
              </div>
            )}
            <div>
              <p className="text-gray-500">Company</p>
              <p className="font-medium text-gray-900">{identity.companyName}</p>
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
