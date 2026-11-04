import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mason Bair",
  description: "Mason Bair, software engineer.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
