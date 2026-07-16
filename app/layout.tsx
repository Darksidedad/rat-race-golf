import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rat Race Golf",
  description: "Fantasy golf drafts, live scoring, and season standings for Rat Race Golf.",
  applicationName: "Rat Race Golf",
  appleWebApp: {
    capable: true,
    title: "Rat Race Golf",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.png", sizes: "512x512", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    apple: [
      { url: "/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" },
    ],
  },
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
