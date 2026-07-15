import type { CapacitorConfig } from "@capacitor/cli";

const liveUrl = String(process.env.CAPACITOR_SERVER_URL ?? "https://ground-workpro.vercel.app").trim();
const liveUrlHost = liveUrl ? new URL(liveUrl).host : null;

const config: CapacitorConfig = {
  appId: "com.groundworkpro.app",
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
