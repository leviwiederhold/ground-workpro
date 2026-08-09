import Link from "next/link";

export default function AccountDeletionPage() {
  return (
    <main className="min-h-screen bg-black px-6 py-16 text-white">
      <div className="mx-auto max-w-3xl space-y-8">
        <h1 className="text-4xl font-bold">Delete your Groundwork Pro account</h1>
        <p className="text-zinc-300">
          Sign in, open Account Settings, and use Delete Account to permanently delete your login and personal profile.
        </p>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-xl font-semibold">Start account deletion</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Company owners must transfer ownership or end an active subscription first. Company-owned records may be
            retained where required for billing, legal, security, or business recordkeeping.
          </p>
          <Link
            href="/settings/account"
            className="mt-5 inline-flex rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-black hover:bg-orange-400"
          >
            Sign in and delete account
          </Link>
        </div>
        <p className="text-sm text-zinc-400">
          If you cannot sign in, request deletion at{" "}
          <a
            className="text-orange-400"
            href="mailto:support@groundworkproapp.com?subject=Groundwork%20Pro%20account%20deletion%20request"
          >
            support@groundworkproapp.com
          </a>
          . We may ask you to verify account ownership.
        </p>
      </div>
    </main>
  );
}
