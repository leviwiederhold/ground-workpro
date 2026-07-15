import { redirect } from "next/navigation";

// The company/work-hours configuration now lives in the single in-app Settings
// experience reached from the app navigation (renders SettingsView). This route
// used to render a separate, disconnected form; it now redirects so there is
// exactly ONE Settings surface and no duplicated company form.
export default function CompanySettingsPage() {
  redirect("/settings");
}
