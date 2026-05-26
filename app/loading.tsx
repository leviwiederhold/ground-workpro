/**
 * Next.js route-level loading UI.
 * Rendered automatically during page navigation while the next segment loads.
 * Unmounted once the route resolves — no exit animation needed here.
 */
import ExcavatorLoader from '@/components/loading/ExcavatorLoader';

export default function Loading() {
  return <ExcavatorLoader />;
}
