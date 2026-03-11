import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { CompanySettingsClient } from "./CompanySettingsClient";

export default async function CompanySettingsPage() {
  try {
    await requireRole(["admin"]);
  } catch {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <CompanySettingsClient />
    </main>
  );
}
