import { redirect } from "next/navigation";
import { getCurrentUserIdentity } from "@/lib/user/identity";
import { ProfileClient } from "./ProfileClient";
import { RequireLocationAccess } from "@/app/components/location/RequireLocationAccess";

export default async function MyProfilePage() {
  let identity: Awaited<ReturnType<typeof getCurrentUserIdentity>>;
  try {
    identity = await getCurrentUserIdentity();
  } catch {
    redirect("/login");
  }

  // Location is required to use the app after onboarding.
  return (
    <RequireLocationAccess>
      <ProfileClient identity={identity} />
    </RequireLocationAccess>
  );
}
