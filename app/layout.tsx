import type { Metadata } from "next";
import { OfflineManager } from "@/components/offline-manager";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nyashavee School Management System",
  description: "The operational workspace for Nyashavee schools.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50">
        {children}
        <OfflineManager />
      </body>
    </html>
  );
}
