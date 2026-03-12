import { redirect } from "next/navigation";
import { getCurrentUserIdentity } from "@/lib/user/identity";
import { ProfileClient } from "./ProfileClient";

export default async function MyProfilePage() {
  let identity: Awaited<ReturnType<typeof getCurrentUserIdentity>>;
  try {
    identity = await getCurrentUserIdentity();
  } catch {
    redirect("/login");
  }

  return <ProfileClient identity={identity} />;
}
