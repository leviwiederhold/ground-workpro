import { redirect } from "next/navigation";
import { isCurrentUserPlatformAdmin } from "@/lib/auth/platformAdmin";
import { BillingOverridesClient } from "./BillingOverridesClient";

export const dynamic = "force-dynamic";

// Internal platform-admin console for granting complimentary / discounted
// access. Server-side gate: non-platform-admins (including company CEOs) are
// redirected home and never see this page. The API routes enforce the same gate
// independently, so hiding the UI is not the only protection.
export default async function BillingOverridesPage() {
  const allowed = await isCurrentUserPlatformAdmin();
  if (!allowed) {
    redirect("/");
  }
  return <BillingOverridesClient />;
}
