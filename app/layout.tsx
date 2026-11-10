import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Nav } from "@/components/Nav";
import { PublicOnly } from "@/components/PublicOnly";
import now from "@/content/now.json";
import { siteUrl } from "@/content/site";
import "./globals.css";

const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

const title = "Mason Bair | Software Engineer & Digital Nomad";

const description =
  `I'm Mason Bair, a software engineer at Fullsend. I'm a digital nomad (${now.countriesVisited} countries so far) and I bake with honey instead of sugar.`;

// Share images come from the opengraph-image files, so none are listed here.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: "%s | Mason Bair" },
  description,
  openGraph: { type: "website", siteName: "Mason Bair", title, description, url: "/" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${grotesk.variable} ${jetbrains.variable}`}>
      <body className="font-sans antialiased">
        <PublicOnly>
          <Nav />
        </PublicOnly>
        {children}
      </body>
    </html>
  );
}
