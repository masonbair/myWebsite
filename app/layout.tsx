import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const description =
  "I'm Mason Bair, a software engineer, baker, and traveler who has been to 23 countries and graduated from Kent State in May 2026.";

export const metadata: Metadata = {
  metadataBase: new URL("https://masonbair.com"),
  title: "Mason Bair",
  description,
  openGraph: {
    title: "Mason Bair",
    description,
    images: ["/misc/Mason_web.webp"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        <Nav />
        {children}
      </body>
    </html>
  );
}
