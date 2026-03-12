import type { Metadata } from "next";
import "./globals.css";
import { validateEnv } from "@/lib/env/validateEnv";
import { ThemeInitializer } from "@/app/components/theme/ThemeInitializer";

validateEnv();

export const metadata: Metadata = {
  title: "Groundwork Pro - Excavation Management Platform",
  description: "Groundwork Pro demo UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var key='groundwork.appearance';var stored=localStorage.getItem(key)||'system';var pref=(stored==='light'||stored==='dark'||stored==='system')?stored:'system';var resolved=pref==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):pref;var root=document.documentElement;root.setAttribute('data-appearance',pref);root.setAttribute('data-theme',resolved);if(resolved==='dark'){root.classList.add('dark');}else{root.classList.remove('dark');}}catch(e){var root=document.documentElement;root.setAttribute('data-appearance','system');root.setAttribute('data-theme','light');root.classList.remove('dark');}})();`,
          }}
        />
      </head>
      <body className="bg-gray-50 text-gray-900 antialiased">
        <ThemeInitializer />
        {children}
      </body>
    </html>
  );
}
