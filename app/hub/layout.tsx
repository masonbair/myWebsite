import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hub",
  robots: { index: false, follow: false },
};

export default function HubLayout({ children }: LayoutProps<"/hub">) {
  return <div className="mx-auto min-h-dvh w-full max-w-3xl px-5 pt-28 pb-16">{children}</div>;
}
