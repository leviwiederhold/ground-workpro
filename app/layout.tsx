import type { Metadata, Viewport } from "next";
import "./globals.css";
import { validateEnv } from "@/lib/env/validateEnv";
import { ThemeInitializer } from "@/app/components/theme/ThemeInitializer";

validateEnv();

export const metadata: Metadata = {
  title: "Groundwork Pro - Excavation Management Platform",
  description: "Groundwork Pro demo UI",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/Dozer.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var root=document.documentElement;function apply(pref,resolved){root.setAttribute('data-appearance',pref);root.setAttribute('data-theme',resolved);if(resolved==='dark'){root.classList.add('dark');}else{root.classList.remove('dark');}}try{var pathname=window.location.pathname||'/';var isPublicExact=pathname==='/features'||pathname==='/pricing'||pathname==='/testimonials';var isPublicPrefix=pathname.indexOf('/login')===0||pathname.indexOf('/signup')===0||pathname.indexOf('/forgot-password')===0||pathname.indexOf('/reset-password')===0||pathname.indexOf('/auth/callback')===0||pathname.indexOf('/proposal/')===0;var isPublicPath=isPublicExact||isPublicPrefix;var hasAuthCookie=/(?:^|;\\s*)sb-[^=;]+-auth-token=/.test(document.cookie||'');var forcePublicTheme=sessionStorage.getItem('groundwork.force-public-theme')==='1';if(isPublicPath||((!hasAuthCookie||forcePublicTheme)&&pathname==='/')){apply('light','light');return;}sessionStorage.removeItem('groundwork.force-public-theme');var key='groundwork.appearance';var stored=localStorage.getItem(key)||'dark';var pref=(stored==='light'||stored==='dark'||stored==='system')?stored:'dark';var resolved=pref==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):pref;apply(pref,resolved);}catch(e){apply('dark','dark');}})();`,
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
