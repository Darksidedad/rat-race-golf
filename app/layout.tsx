import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PGA Draft Room",
  description: "Live fantasy golf draft app for weekly PGA tournaments.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
