import { CaptureForm } from "@/components/hub/CaptureForm";
import { requireOwner } from "@/lib/auth/require-owner";

export const metadata = { title: "Capture" };

export default async function CapturePage({ searchParams }: PageProps<"/hub/capture">) {
  await requireOwner();
  const { shared } = await searchParams;
  return (
    <main>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Capture</h1>
      <CaptureForm shared={shared === "1"} />
    </main>
  );
}
