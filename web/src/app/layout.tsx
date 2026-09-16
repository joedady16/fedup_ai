import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fedup AI",
  description: "A private AI assistant for the family.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The composer sits at the bottom; this keeps it above the iOS home bar.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#131417" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
