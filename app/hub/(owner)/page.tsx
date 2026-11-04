import { requireOwner } from "@/lib/auth/require-owner";

export default async function HubPage() {
  await requireOwner();
  return (
    <main>
      <h1 className="text-3xl font-semibold tracking-tight">Hub</h1>
      <p className="mt-3 text-mute">You are signed in.</p>
    </main>
  );
}
