import { HubTabs } from "@/components/hub/HubTabs";
import { requireOwner } from "@/lib/auth/require-owner";

// Pages under here must also call requireOwner(), since a layout does not re-run on every navigation.
export default async function OwnerLayout({ children }: LayoutProps<"/hub">) {
  await requireOwner();
  return (
    <>
      <HubTabs />
      {children}
    </>
  );
}
