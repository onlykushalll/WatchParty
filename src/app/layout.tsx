import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WatchParty — Watch & browse together, in perfect sync",
  description: "Create a room, paste any video URL, and watch together in real time. YouTube, HLS, MP4, or any site — synced with NTP-grade clock sync.",
  keywords: ["watchparty", "watch together", "sync video", "co-browse", "real-time"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

// Inline script to set theme before hydration (prevents FOUC).
// This runs before React hydrates, setting the dark class on <html>.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(!t||t==='dark'){document.documentElement.classList.add('dark')}else{document.documentElement.classList.remove('dark')}}catch(e){document.documentElement.classList.add('dark')}})()`;

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
        {children}
        <Toaster />
        <SonnerToaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
