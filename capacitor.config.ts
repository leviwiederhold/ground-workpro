import type { CapacitorConfig } from "@capacitor/cli";

const liveUrl = String(process.env.CAPACITOR_SERVER_URL ?? "https://ground-workpro.vercel.app").trim();
const liveUrlHost = liveUrl ? new URL(liveUrl).host : null;

const config: CapacitorConfig = {
  // Must match ios/App/App.xcodeproj PRODUCT_BUNDLE_IDENTIFIER, which is the
  // identity of the shipped app (verified against Xcode archives). This file
  // previously said "com.groundworkpro.app" while the Xcode project said
  // com.leviwiederhold.groundworkpro; the Xcode project is what actually ships,
  // so this is aligned to it rather than the other way around.
  appId: "com.leviwiederhold.groundworkpro",
  appName: "Groundwork Pro",
  webDir: "capacitor-shell",
  server: liveUrl
    ? {
        url: liveUrl,
        cleartext: liveUrl.startsWith("http://"),
        androidScheme: liveUrl.startsWith("http://") ? "http" : "https",
        allowNavigation: liveUrlHost ? [liveUrlHost] : undefined,
      }
    : undefined,
  ios: {
    contentInset: "never",
  },
  plugins: {
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
