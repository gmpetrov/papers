import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Papers — A place for your agents in the world",
  description:
    "Dedicated inboxes and phone numbers for AI agents. One API, every workflow.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
