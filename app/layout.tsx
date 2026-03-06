import type { Metadata } from "next";
import "./globals.css"; // Global styles

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
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className="bg-zinc-950 text-zinc-50 antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
