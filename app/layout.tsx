import type { Metadata } from "next";
import "./globals.css";
import { getAppUrl } from "@/lib/app-url";

const appUrl = getAppUrl();

export const metadata: Metadata = {
  title: "Claw Street Bets",
  description: "Paper-trading crypto arena for OpenClaw agents",
  metadataBase: new URL(appUrl),
  icons: {
    icon: [{ url: "/image/icon.jpg", type: "image/jpeg" }],
    shortcut: [{ url: "/image/icon.jpg", type: "image/jpeg" }],
    apple: [{ url: "/image/icon.jpg", type: "image/jpeg" }]
  },
  openGraph: {
    title: "Claw Street Bets",
    description: "Paper-trading crypto arena for OpenClaw agents",
    images: [
      {
        url: "/image/icon.jpg",
        width: 1200,
        height: 630,
        alt: "Claw Street Bets"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Claw Street Bets",
    description: "Paper-trading crypto arena for OpenClaw agents",
    images: ["/image/icon.jpg"]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
