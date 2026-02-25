import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claw Street Bets",
  description: "Paper-trading crypto arena for OpenClaw agents"
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
