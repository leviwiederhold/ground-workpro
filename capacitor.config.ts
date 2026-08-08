import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CapacitorConfig } from "@capacitor/cli";
import { resolveServerUrl } from "./src/lib/native/serverUrl";

// The iOS app is a remote-URL Capacitor shell — it loads a deployed site rather
// than bundling the web app. `server.url` below is written into
// ios/App/App/capacitor.config.json by `npx cap sync ios`, so which deployment
// the app loads is decided at sync time.
//
// To point the app at a PR preview instead of production:
//   pnpm ios:preview          (reads CAPACITOR_SERVER_URL)
// To go back:
//   pnpm ios:sync
//
// See docs/native-auth-setup.md.

// Minimal .env reader. The Capacitor CLI does not load .env files, and adding a
// dotenv dependency for one variable isn't worth it. Only CAPACITOR_SERVER_URL
// is read from here; a real environment variable always wins.
function readLocalEnvValue(key: string): string | undefined {
  const candidates = [".env.capacitor.local", ".env.local"];

  for (const file of candidates) {
    let contents: string;
    try {
      contents = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue; // Missing file is the normal case.
    }

    for (const rawLine of contents.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const separator = line.indexOf("=");
      if (separator === -1) continue;
      if (line.slice(0, separator).trim() !== key) continue;

      // Strip matching surrounding quotes and any trailing comment.
      let value = line.slice(separator + 1).trim();
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
        value = value.slice(1, -1);
      } else {
        value = value.split(" #")[0].trim();
      }
      if (value) return value;
    }
  }

  return undefined;
}

const rawServerUrl = process.env.CAPACITOR_SERVER_URL ?? readLocalEnvValue("CAPACITOR_SERVER_URL");
const resolution = resolveServerUrl(rawServerUrl);

// Fail the sync loudly. Falling back to production on a malformed value would
// produce a build that looks configured but silently loads the wrong site.
if (!resolution.ok) {
  throw new Error(`[capacitor.config] ${resolution.message}`);
}

const liveUrl = resolution.url;
const liveUrlHost = new URL(liveUrl).host;

if (!resolution.isProduction) {
  // Visible in `cap sync` output so a non-production sync is never a surprise.
  console.warn(
    `[capacitor.config] Using NON-PRODUCTION server URL: ${liveUrl}\n` +
      `[capacitor.config] Release/archive builds will refuse this URL. Run "pnpm ios:sync" to restore production.`,
  );
}

const config: CapacitorConfig = {
  // Must match ios/App/App.xcodeproj PRODUCT_BUNDLE_IDENTIFIER, which is the
  // identity of the shipped app (verified against Xcode archives). This file
  // previously said "com.groundworkpro.app" while the Xcode project said
  // com.leviwiederhold.groundworkpro; the Xcode project is what actually ships,
  // so this is aligned to it rather than the other way around.
  appId: "com.leviwiederhold.groundworkpro",
  appName: "Groundwork Pro",
  webDir: "capacitor-shell",
  server: {
    url: liveUrl,
    cleartext: liveUrl.startsWith("http://"),
    androidScheme: liveUrl.startsWith("http://") ? "http" : "https",
    allowNavigation: [liveUrlHost],
  },
  ios: {
    contentInset: "never",
  },
  plugins: {
    PushNotifications: {
      // Background/terminated alerts are presented by iOS. In the foreground,
      // the web app refreshes its message state without a second intrusive
      // system banner (especially when that conversation is already open).
      presentationOptions: [],
    },
    SocialLogin: {
      providers: {
        apple: true,
        google: true,
        facebook: false,
        twitter: false,
      },
      logLevel: 1,
    },
  },
};

export default config;
