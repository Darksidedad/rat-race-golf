import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rat Race Golf",
  description: "Fantasy golf drafts, live scoring, and season standings for Rat Race Golf.",
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
