import { ArrowLeft, GoogleLogo } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { SubmitButton } from "@/components/hub/SubmitButton";
import { CostSummary } from "@/components/hub/ideas/CostSummary";
import { focusRing, panel, primaryButton, quietButton } from "@/components/hub/styles";
import { disconnectGoogle } from "@/app/hub/ideas-actions";
import { monthSpend } from "@/lib/ai/claude";
import { requireOwner } from "@/lib/auth/require-owner";
import { googleConfig, readGoogleRow } from "@/lib/ideas/google";
import { budgetFromEnv } from "@/lib/ideas/job";
import { reviewCostThisMonth } from "@/lib/ideas/read";
import { serviceClient, sessionClient } from "@/lib/supabase/server";

export const metadata = { title: "Ideas Lab settings" };

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Google Calendar is connected. Your Ideas calendar is ready.", ok: true },
  denied: { text: "Google was not connected, because the Google screen was closed or declined.", ok: false },
  "no-lasting-token": {
    text: "Google did not give a lasting token. Remove the app at myaccount.google.com/permissions and connect again.",
    ok: false,
  },
  "not-configured": { text: "Google is not set up on this site yet.", ok: false },
  failed: { text: "Connecting to Google did not work. Try again in a minute.", ok: false },
  "revoke-failed": { text: "Google did not answer. Google is still connected. Try Disconnect again later.", ok: false },
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: process.env.HUB_TIME_ZONE || "America/Denver" });
}

export default async function IdeasSettingsPage({ searchParams }: PageProps<"/hub/ideas/settings">) {
  await requireOwner("/hub/ideas/settings");
  const { google: outcome } = await searchParams;
  const message = typeof outcome === "string" ? MESSAGES[outcome] : undefined;

  const now = new Date();
  const session = await sessionClient();
  const [row, spend, reviews] = await Promise.all([
    readGoogleRow(serviceClient()),
    monthSpend(session, "ideas", now),
    reviewCostThisMonth(session, now),
  ]);
  const configured = googleConfig() !== null;
  const cap = budgetFromEnv(process.env.IDEAS_MONTHLY_BUDGET_USD);

  return (
    <main>
      <Link
        href="/hub/ideas"
        className={`inline-flex items-center gap-1.5 text-sm font-medium text-mute transition-colors hover:text-ink ${focusRing}`}
      >
        <ArrowLeft size={16} weight="bold" aria-hidden />
        Ideas Lab
      </Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Settings</h1>

      {message && (
        <p role="status" className={`mt-4 max-w-[60ch] rounded-tile px-4 py-3 text-sm ring-1 ring-inset ${message.ok ? "ring-accent/40 text-ink" : "ring-ink/15 text-ink"}`}>
          {message.text}
        </p>
      )}

      <section aria-labelledby="google-calendar" className={`${panel} mt-6 px-5 py-5`}>
        <h2 id="google-calendar" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <GoogleLogo size={16} weight="bold" aria-hidden />
          Google Calendar
        </h2>
        {!configured ? (
          <>
            <p className="mt-2 text-sm text-ink">Not set up yet.</p>
            <p className="mt-1 max-w-[60ch] text-sm text-mute">
              Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel, then redeploy. The steps are in docs/hub-setup.md under Ideas Lab.
            </p>
          </>
        ) : row.connected ? (
          <>
            <p className="mt-2 text-sm text-ink">Connected{row.connected_at ? ` since ${day(row.connected_at)}` : ""}.</p>
            <p className="mt-1 max-w-[60ch] text-sm text-mute">
              Ideas come back as short events on a calendar named Ideas. On your phone, open Google Calendar, Settings, and turn on sync for Ideas.
            </p>
            <form action={disconnectGoogle} className="mt-4">
              <SubmitButton className={quietButton}>Disconnect</SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink">
              Not connected{row.disconnected_at ? `. Disconnected on ${day(row.disconnected_at)}` : ""}.
            </p>
            <p className="mt-1 max-w-[60ch] text-sm text-mute">
              Connecting lets the Ideas Lab make one calendar named Ideas and add events to it. It cannot see your other calendars.
            </p>
            <form action="/hub/ideas/google/start" method="post" className="mt-4">
              <button type="submit" className={primaryButton}>
                Connect Google Calendar
              </button>
            </form>
            <p className="mt-3 max-w-[60ch] text-xs text-mute">
              After connecting, on your phone, open Google Calendar, Settings, and turn on sync for Ideas.
            </p>
          </>
        )}
      </section>

      <div className="mt-6">
        <CostSummary costs={{ thisMonth: spend.thisMonth, lastMonth: spend.lastMonth, reviews: reviews.reviews, reviewCost: reviews.costUsd, cap }} />
      </div>
    </main>
  );
}
