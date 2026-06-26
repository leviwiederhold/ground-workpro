import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10 text-gray-900">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <i className="fa-solid fa-lock" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">Access restricted</h1>
        <p className="mt-2 text-sm text-gray-600">
          You do not have permission to view that page. Contact your company administrator if you need access.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
