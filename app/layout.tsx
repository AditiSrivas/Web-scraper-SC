import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Active Roles Email Generator",
  description: "Generate personalized hiring outreach emails from LinkedIn active role exports"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
