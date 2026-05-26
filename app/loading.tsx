/**
 * Next.js route-level loading UI — lightweight spinner.
 * Shown during page navigation while the next segment loads.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
