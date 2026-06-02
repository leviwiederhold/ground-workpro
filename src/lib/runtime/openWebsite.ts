// Opens the Groundwork Pro public marketing/setup website in the device's
// default EXTERNAL browser (Safari on iOS) — never the in-app WebView.
//
// In Capacitor, window.open(url, "_system") hands the URL to the OS.
//
// Primary apex domain with a www fallback used only if the apex appears
// unreachable (DNS/connection failure). The reachability probe is best-effort
// and time-boxed so the CTA never hangs.

const PRIMARY_URL = "https://groundwork-pro.com";
const FALLBACK_URL = "https://www.groundwork-pro.com";

async function resolveWebsiteUrl(): Promise<string> {
  if (typeof fetch === "undefined") return PRIMARY_URL;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    // no-cors: resolves opaquely when reachable, rejects on DNS/connection error.
    await fetch(PRIMARY_URL, { mode: "no-cors", signal: controller.signal });
    clearTimeout(timer);
    return PRIMARY_URL;
  } catch {
    // Apex unreachable (e.g. domain not live yet) — use the www host.
    return FALLBACK_URL;
  }
}

export async function openGroundworkWebsite(): Promise<void> {
  if (typeof window === "undefined") return;
  const url = await resolveWebsiteUrl();
  window.open(url, "_system");
}

export { PRIMARY_URL as GROUNDWORK_WEB_URL, FALLBACK_URL as GROUNDWORK_WEB_URL_FALLBACK };
