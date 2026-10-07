export default function PrivacyPage() {
  return (
    <section className="min-h-screen bg-black text-white px-6 py-16">
      <div className="max-w-3xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold">Privacy Policy</h1>

        <p className="text-zinc-400">
          Groundwork Pro respects your privacy and uses personal information only to provide, secure, and support the service.
        </p>

        <div>
          <h2 className="text-2xl font-semibold mb-2">Information We Collect</h2>
          <p className="text-zinc-400">
            We collect account and company information, messages and uploaded media, equipment and scheduling data,
            device identifiers and push-notification tokens, and other operational records users choose to enter.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-2">Location and Automatic Attendance</h2>
          <p className="text-zinc-400">
            For employees assigned to automatic attendance, Groundwork Pro uses precise location in the background,
            including when the app is closed or not in use, to record discrete jobsite arrival and departure events.
            Groundwork Pro does not create a continuous employee location history or employee map.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-2">How We Use Information</h2>
          <p className="text-zinc-400">
            Information is used for app functionality, authentication, customer support, fraud and security prevention,
            billing, messaging, document storage, scheduling, equipment management, and automatic attendance.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-2">Service Providers</h2>
          <p className="text-zinc-400">
            We use service providers such as Supabase, Vercel, Stripe, Apple, Google, and push-notification providers
            to host, authenticate, bill, store, and deliver Groundwork Pro. They process data only for those services.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-2">Data Security</h2>
          <p className="text-zinc-400">
            We use industry-standard security practices and third-party infrastructure
            providers to help protect user information.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-2">Retention and Deletion</h2>
          <p className="text-zinc-400">
            We retain information while an account or company relationship is active and as needed for security,
            billing, legal, and business recordkeeping. Users can delete their account in Account Settings or begin a
            request on the{" "}
            <a href="/account-deletion" className="text-orange-400">account deletion page</a>.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-2">Contact</h2>
          <p className="text-zinc-400">
            For privacy-related questions, contact:
          </p>

          <a
            href="mailto:support@groundworkproapp.com"
            className="text-orange-400"
          >
            support@groundworkproapp.com
          </a>
        </div>

        <div className="pt-8 border-t border-zinc-900 text-zinc-500 text-sm">
          © 2026 Groundwork Pro
        </div>
      </div>
    </section>
  );
}
