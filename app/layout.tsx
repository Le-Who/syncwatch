import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css"; // Global styles

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "SyncWatch - Watch Together",
  description: "Watch videos together with friends in perfect sync.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${outfit.variable}`}
      suppressHydrationWarning
    >
      <body
        className="bg-[#050505] text-zinc-50 font-sans antialiased selection:bg-indigo-500/30"
        suppressHydrationWarning
      >
        {/* Subtle cinematic noise overlay */}
        <div
          className="pointer-events-none fixed inset-0 z-50 h-full w-full opacity-[0.03] mix-blend-overlay"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")',
          }}
        ></div>
        {children}
        <Toaster
          theme="dark"
          position="bottom-left"
          toastOptions={{
            className:
              "bg-[#111111] border-zinc-800 text-zinc-100 font-sans backdrop-blur-xl",
          }}
        />
      </body>
    </html>
  );
}
