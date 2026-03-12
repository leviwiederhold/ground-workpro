import { redirect } from "next/navigation";
import { getCurrentUserIdentity } from "@/lib/user/identity";
import { AccountSettingsClient } from "./AccountSettingsClient";

export default async function AccountSettingsPage() {
  try {
    await getCurrentUserIdentity();
  } catch {
    redirect("/login");
  }

  return <AccountSettingsClient />;
}
