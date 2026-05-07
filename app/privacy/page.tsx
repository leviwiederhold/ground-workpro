export default function PrivacyPage() {
  return (
    <section className="min-h-screen bg-black text-white px-6 py-16">
      <div className="max-w-3xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold">Privacy Policy</h1>

        <p className="text-zinc-400">
          Groundwork Pro respects your privacy and is committed to protecting your information.
        </p>

        <div>
          <h2 className="text-2xl font-semibold mb-2">Information We Collect</h2>
          <p className="text-zinc-400">
            We may collect account information, company information, uploaded files,
            equipment data, scheduling information, and other operational data
            required to provide app functionality.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-2">How We Use Information</h2>
          <p className="text-zinc-400">
            Information is used to operate Groundwork Pro, improve the platform,
            support users, and provide core functionality such as scheduling,
            equipment management, messaging, and document storage.
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
          <h2 className="text-2xl font-semibold mb-2">Contact</h2>
          <p className="text-zinc-400">
            For privacy-related questions, contact:
          </p>

          <a
            href="mailto:le"
            className="text-orange-400"
          >
            levi.wiederhold@gmail.com
          </a>
        </div>

        <div className="pt-8 border-t border-zinc-900 text-zinc-500 text-sm">
          © 2026 Groundwork Pro
        </div>
      </div>
    </section>
  );
}