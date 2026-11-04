"use client";

import { quietButton } from "@/components/hub/styles";

export default function HubError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main role="alert">
      <h1 className="text-2xl font-semibold tracking-tight">That did not work</h1>
      <p className="mt-2 text-mute">The hub could not load or save. Your data is safe.</p>
      <button type="button" onClick={() => retry()} className={`${quietButton} mt-5`}>
        Try again
      </button>
    </main>
  );
}
