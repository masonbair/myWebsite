import { cookies, headers } from "next/headers";
import { panel, primaryButton, quietButton } from "@/components/hub/styles";
import { requireOwner } from "@/lib/auth/require-owner";
import { isLocalHost } from "@/lib/auth/return-cookie";
import { REQUEST_COOKIE, requestFromCookie } from "@/lib/hub/oauth";

export const metadata = { title: "Connect Claude" };

export default async function ConnectPage() {
  await requireOwner("/hub/connect");
  const host = (await headers()).get("host") ?? "";
  const origin = `${isLocalHost(host) ? "http" : "https"}://${host}`;
  const pending = requestFromCookie((await cookies()).get(REQUEST_COOKIE)?.value, origin);

  return (
    <main className={`${panel} mx-auto mt-16 max-w-md p-8`}>
      <h1 className="text-3xl font-semibold tracking-tight">Connect Claude</h1>
      {pending ? (
        <>
          <p className="mt-3 text-ink">Claude wants to use your hub.</p>
          <p className="mt-2 text-sm text-mute">
            It can read and add items, comments and timeline notes, with the same limits as your other agents. It cannot
            complete or delete anything. You will go back to <strong className="text-ink">{new URL(pending.redirectUri).host}</strong>.
          </p>
          <p className="mt-2 text-sm text-mute">Only allow this if you just pressed Connect in Claude yourself.</p>
          <form method="post" action="/api/oauth/approve" className="mt-6 flex gap-3">
            <button type="submit" name="decision" value="allow" className={primaryButton}>
              Allow
            </button>
            <button type="submit" name="decision" value="deny" className={quietButton}>
              Cancel
            </button>
          </form>
        </>
      ) : (
        <p role="alert" className="mt-3 text-sm font-medium text-accent-ink">
          This sign-in link expired or is missing. Start again from Claude.
        </p>
      )}
    </main>
  );
}
