import Link from "next/link";
import { notFound } from "next/navigation";
import { EmailText } from "@/components/hub/EmailText";
import { ReleaseIssueForm } from "@/components/hub/ReleaseIssueForm";
import { focusRing, panel } from "@/components/hub/styles";
import { requireOwner } from "@/lib/auth/require-owner";
import { emailPlainText } from "@/lib/news/email-view";
import { loadRawEmail } from "@/lib/news/raw-email";
import { sessionClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";

export const metadata = { title: "Held back email" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QuarantinePage({ params }: PageProps<"/hub/news/quarantine/[id]">) {
  await requireOwner();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const client = await sessionClient();
  const [{ data }, { data: sources }] = await Promise.all([
    client.from("news_issues").select("subject, from_address, received_at, raw_path, source_id").eq("id", id).eq("status", "quarantined").maybeSingle(),
    client.from("news_sources").select("id, name").neq("id", "shared").order("name"),
  ]);
  if (!data) notFound();

  const email = await loadRawEmail(data.raw_path);
  const text = email ? emailPlainText(email) : null;

  return (
    <main>
      <Link href="/hub/news" className={`inline-flex min-h-10 items-center text-sm font-medium text-mute hover:text-ink ${focusRing}`}>
        Back to News
      </Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight break-words">{data.subject || "No subject"}</h1>
      <p className="mt-2 text-sm break-all text-mute">
        From {data.from_address || "an unknown sender"} · {timeAgo(data.received_at)}
      </p>
      <p className="mt-2 max-w-[60ch] text-mute">This email did not match a newsletter, so it was held back. Links open in a new tab.</p>

      <section aria-labelledby="release" className={`${panel} mt-8 p-5 sm:p-6`}>
        <h2 id="release" className="mb-1 text-sm font-semibold text-mute">
          Release
        </h2>
        <p className="mb-4 max-w-[60ch] text-sm text-mute">
          If this is a newsletter you read, release it and it gets read on the next run like any other issue.
        </p>
        <ReleaseIssueForm id={id} sources={sources ?? []} current={data.source_id} />
      </section>

      <section aria-labelledby="body" className={`${panel} mt-8 p-5 sm:p-6`}>
        <h2 id="body" className="mb-3 text-sm font-semibold text-mute">
          Email text
        </h2>
        {text === null ? (
          <p className="text-sm text-mute">The raw email could not be loaded.</p>
        ) : text === "" ? (
          <p className="text-sm text-mute">This email has no text.</p>
        ) : (
          <EmailText text={text} />
        )}
      </section>
    </main>
  );
}
