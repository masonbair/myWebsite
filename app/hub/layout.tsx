import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hub",
  robots: { index: false, follow: false },
};

export default function HubLayout({ children }: LayoutProps<"/hub">) {
  return <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 pt-6 pb-16 sm:px-5 sm:pt-10">{children}</div>;
}
