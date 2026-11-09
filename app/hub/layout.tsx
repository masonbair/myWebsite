import type { Metadata, Viewport } from "next";
import { HubServiceWorker } from "@/components/hub/HubServiceWorker";

export const metadata: Metadata = {
  title: "Hub",
  robots: { index: false, follow: false },
  manifest: "/hub/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Hub", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6fd" },
    { media: "(prefers-color-scheme: dark)", color: "#15142a" },
  ],
};

export default function HubLayout({ children }: LayoutProps<"/hub">) {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 pt-6 pb-16 sm:px-5 sm:pt-10">
      <noscript>
        <p role="status" className="mb-6 rounded-tile border-[2.5px] border-line bg-surface p-4 text-sm font-medium text-accent-ink shadow-tile">
          This page needs JavaScript. Turn it on for masonbair.com in your browser settings.
        </p>
      </noscript>
      {/* Registered on signed-out pages too: browsers offer install only once a worker controls the page. */}
      <HubServiceWorker />
      {children}
    </div>
  );
}
