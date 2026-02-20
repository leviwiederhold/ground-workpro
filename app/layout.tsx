import type { Metadata } from "next";
import "./globals.css";
import { validateEnv } from "@/lib/env/validateEnv";

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
    <html lang="en">
      <body className="bg-gray-50">{children}</body>
    </html>
  );
}
