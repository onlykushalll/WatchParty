import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/watchparty/error-boundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WatchParty — Watch together, in perfect sync",
  description: "Create a room, paste any video URL, and watch together in real time. YouTube, HLS, MP4 — synced with NTP-grade clock sync.",
  keywords: ["watchparty", "watch together", "sync video", "co-browse", "real-time"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ErrorBoundary>
          {children}
          <Toaster />
          <SonnerToaster position="bottom-right" richColors closeButton />
        </ErrorBoundary>
      </body>
    </html>
  );
}
