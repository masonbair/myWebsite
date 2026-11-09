import type { Metadata } from "next";
import Link from "next/link";
import { Newspaper, TrendUp } from "@phosphor-icons/react/dist/ssr";
import { Reveal } from "@/components/board/Reveal";
import { Tile } from "@/components/board/Tile";
import { JsonLd } from "@/components/JsonLd";
import {
  subjectHref,
  TrendList,
  TrendsFooter,
} from "@/components/trends/TrendList";
import { siteUrl } from "@/content/site";
import { PERSON_ID } from "@/lib/jsonld";
import { moveText, trendsOverview } from "@/lib/news/movers";
import { readPublicTrends } from "@/lib/news/public";

export const revalidate = 3600;

const TITLE = "Newsletter trends";
const DESCRIPTION =
  "Which topics and companies six newsletters I read covered over the last 30 days, what is rising or falling, and the tone.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/trends" },
  openGraph: {
    type: "website",
    siteName: "Mason Bair",
    title: TITLE,
    description: DESCRIPTION,
    url: "/trends",
  },
};

const LIST_SIZE = 12;

export default async function TrendsPage() {
  const { byId, rising, topics: allTopics, companies: allCompanies } = trendsOverview(await readPublicTrends());
  const topics = allTopics.slice(0, LIST_SIZE);
  const companies = allCompanies.slice(0, LIST_SIZE);
  const counts = [
    { label: "Topics", value: allTopics.length },
    { label: "Companies", value: allCompanies.length },
  ];

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pt-24 pb-24 md:px-8">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          url: `${siteUrl}/trends`,
          name: TITLE,
          description: DESCRIPTION,
          about: { "@id": PERSON_ID },
        }}
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <Reveal index={0} className="lg:col-span-7">
          <Tile core="flex h-full flex-col bg-surface p-7 md:p-12">
            <h1 className="max-w-[16ch] text-4xl leading-[0.95] font-extrabold tracking-tighter text-ink md:text-6xl">
              What six newsletters talked about
            </h1>
            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-mute">
              Topics and companies from the newsletters I read each morning,
              counted by day. Last 30 days.
            </p>
            <dl className="mt-auto flex flex-wrap gap-x-12 gap-y-4 pt-10">
              {counts.map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-sm text-mute">{label} covered</dt>
                  <dd className="mt-1 font-mono text-3xl font-medium tracking-tight text-ink">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Tile>
        </Reveal>

        <Reveal index={1} className="lg:col-span-5">
          <section aria-labelledby="rising-title" className="h-full">
            <Tile core="flex h-full flex-col bg-accent p-7 text-night md:p-10">
              <TrendUp weight="light" size={36} aria-hidden />
              <h2
                id="rising-title"
                className="mt-6 text-2xl font-bold tracking-tight"
              >
                Topics rising this week
              </h2>
              {rising.length > 0 ? (
                <ul className="mt-5 flex flex-col gap-2">
                  {rising.map((m) => (
                    <li key={`${m.kind}:${m.key}`}>
                      <Link
                        href={subjectHref(m)}
                        className="flex flex-col rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-night sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                      >
                        <span className="min-w-0 truncate text-lg font-semibold underline-offset-4 hover:underline">
                          {m.label}
                        </span>
                        <span className="shrink-0 text-sm">
                          <span className="font-mono">{m.last7}</span>{" "}
                          {m.last7 === 1 ? "story" : "stories"} this week,{" "}
                          {moveText(m)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-base">
                  Nothing is clearly rising right now.
                </p>
              )}
            </Tile>
          </section>
        </Reveal>
      </div>

      {topics.length === 0 && companies.length === 0 ? (
        <Reveal index={2} className="mt-4 block">
          <Tile core="flex flex-col items-start gap-4 bg-surface p-7 md:p-12">
            <Newspaper
              weight="light"
              size={36}
              className="text-accent-ink"
              aria-hidden
            />
            <p className="text-2xl font-bold tracking-tight text-ink">
              Nothing to show yet.
            </p>
            <p className="max-w-[52ch] text-mute">
              Counts show up here once the first newsletters have been read.
            </p>
          </Tile>
        </Reveal>
      ) : (
        <div className="mt-4 grid gap-4">
          {[
            { id: "topics", title: "Topics", subjects: topics },
            { id: "companies", title: "Companies", subjects: companies },
          ].map(({ id, title, subjects }, i) =>
            subjects.length > 0 ? (
              <Reveal key={id} index={i + 2}>
                <section aria-labelledby={`${id}-title`}>
                  <Tile core="bg-surface p-3 md:p-6">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-3">
                      <h2
                        id={`${id}-title`}
                        className="text-2xl font-bold tracking-tight text-ink md:text-3xl"
                      >
                        {title}
                      </h2>
                      <p className="text-sm text-mute">
                        Stories in the last 30 days
                      </p>
                    </div>
                    <TrendList subjects={subjects} movers={byId} />
                  </Tile>
                </section>
              </Reveal>
            ) : null,
          )}
        </div>
      )}

      <TrendsFooter />
    </main>
  );
}
