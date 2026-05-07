export default function SupportPage() {
  return (
    <section className="min-h-screen bg-black text-white px-6 py-16">
      <div className="max-w-3xl mx-auto">
        
        <h1 className="text-4xl font-bold mb-4">
          Groundwork Pro Support
        </h1>

        <p className="text-zinc-400 mb-10 text-lg">
          Need help with Groundwork Pro? Contact us below and we’ll get back to you as soon as possible.
        </p>

        <div className="space-y-8">

          <div className="border border-zinc-800 rounded-2xl p-6 bg-zinc-950">
            <h2 className="text-2xl font-semibold mb-2">
              Support Email
            </h2>

            <p className="text-zinc-400 mb-3">
              For technical support, account issues, bugs, billing questions, or general help.
            </p>

            <a
              href="mailto:support@groundworkproapp.com"
              className="text-orange-400 text-lg font-medium"
            >
              levi.wiederhold@gmail.com
            </a>
          </div>

          <div className="border border-zinc-800 rounded-2xl p-6 bg-zinc-950">
            <h2 className="text-2xl font-semibold mb-2">
              Common Help
            </h2>

            <ul className="space-y-3 text-zinc-300">
              <li>• Account login and access issues</li>
              <li>• Employee invite problems</li>
              <li>• Fleet and equipment tracking support</li>
              <li>• Calendar and scheduling help</li>
              <li>• Subscription and billing questions</li>
              <li>• Bug reports and app feedback</li>
            </ul>
          </div>

          <div className="border border-zinc-800 rounded-2xl p-6 bg-zinc-950">
            <h2 className="text-2xl font-semibold mb-2">
              Response Time
            </h2>

            <p className="text-zinc-400">
              Most support requests receive a response within 1–2 business days.
            </p>
          </div>

        </div>

        <div className="mt-12 pt-8 border-t border-zinc-900 text-zinc-500 text-sm">
          © 2026 Groundwork Pro
        </div>

      </div>
    </section>
  );
}