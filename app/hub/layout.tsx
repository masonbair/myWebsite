import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Hub",
  robots: { index: false, follow: false },
  manifest: "/hub/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Hub", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6fd" },
    { media: "(prefers-color-scheme: dark)", color: "#121120" },
  ],
};

export default function HubLayout({ children }: LayoutProps<"/hub">) {
  return <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 pt-6 pb-16 sm:px-5 sm:pt-10">{children}</div>;
}
