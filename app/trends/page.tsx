import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { Newspaper, TrendUp } from "@phosphor-icons/react/dist/ssr";
import { Reveal } from "@/components/board/Reveal";
import { Prompt, Tile } from "@/components/board/Tile";
import { tag } from "@/components/ui/sticker";
import { JsonLd } from "@/components/JsonLd";
import {
  subjectHref,
  TrendList,
  TrendsFooter,
} from "@/components/trends/TrendList";
import { siteUrl } from "@/content/site";
import { PERSON_ID } from "@/lib/jsonld";
import { moveText, trendsOverview } from "@/lib/news/movers";
import { hasTrendData, readPublicTrends } from "@/lib/news/public";

export const revalidate = 3600;

const TITLE = "Newsletter trends";
const DESCRIPTION =
  "Which topics and companies six newsletters I read covered over the last 30 days, what is rising or falling, and the tone.";

const loadTrends = cache(() => readPublicTrends());

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...baseMetadata,
    // An empty page reads as thin content to search engines, so it stays out of the index until counts exist.
    ...(hasTrendData(await loadTrends()) ? {} : { robots: { index: false, follow: true } }),
  };
}

const baseMetadata: Metadata = {
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
  const { byId, rising, topics: allTopics, companies: allCompanies } = trendsOverview(await loadTrends());
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

      <div className="grid gap-4 md:gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Tile core="flex h-full flex-col bg-surface p-7 md:p-12">
            <Prompt className="text-accent-ink">cat trends.txt</Prompt>
            <h1 className="mt-2 max-w-[16ch] text-5xl leading-[0.95] font-bold tracking-[-0.04em] text-ink md:text-6xl">
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
        </div>

        <div className="lg:col-span-5">
          <section aria-labelledby="rising-title" className="h-full">
            <Tile tilt="right" core="flex h-full flex-col bg-accent p-7 text-night md:p-10">
              <div className="flex items-start justify-between gap-4">
                <span className={`${tag} border-night bg-surface text-[11px] text-ink`}>This week</span>
                <TrendUp weight="light" size={40} aria-hidden />
              </div>
              <h2
                id="rising-title"
                className="mt-6 text-3xl leading-none font-bold tracking-[-0.04em]"
              >
                Topics rising this week
              </h2>
              {rising.length > 0 ? (
                <ul className="mt-5 flex flex-col divide-y-2 divide-dashed divide-night/30">
                  {rising.map((m) => (
                    <li key={`${m.kind}:${m.key}`}>
                      <Link
                        href={subjectHref(m)}
                        className="flex flex-col rounded-lg py-2 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-night sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
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
        </div>
      </div>

      {topics.length === 0 && companies.length === 0 ? (
        <Reveal index={2} className="mt-4 block md:mt-5">
          <div className="rounded-tile border-2 border-dashed border-line/40 px-7 py-10 md:px-12">
            <Newspaper
              weight="light"
              size={40}
              className="text-accent-ink"
              aria-hidden
            />
            <p className="mt-4 text-2xl font-bold tracking-tight text-ink">
              Nothing to show yet.
            </p>
            <p className="mt-2 max-w-[52ch] text-mute">
              Counts show up here once the first newsletters have been read.
            </p>
          </div>
        </Reveal>
      ) : (
        <div className="mt-4 grid gap-4 md:mt-5 md:gap-5 lg:grid-cols-12">
          {[
            { id: "topics", title: "Topics", prompt: "ls topics/", subjects: topics },
            { id: "companies", title: "Companies", prompt: "ls companies/", subjects: companies },
          ].map(({ id, title, prompt, subjects }, i) =>
            subjects.length > 0 ? (
              <Reveal key={id} index={i + 2} className="lg:col-span-12">
                <section aria-labelledby={`${id}-title`}>
                  <Tile core="bg-surface p-3 md:p-6">
                    <div className="flex flex-wrap items-end justify-between gap-2 px-4 pt-4 pb-3">
                      <div>
                        <Prompt className="text-accent-ink">{prompt}</Prompt>
                        <h2
                          id={`${id}-title`}
                          className="mt-2 text-3xl leading-none font-bold tracking-[-0.04em] text-ink md:text-4xl"
                        >
                          {title}
                        </h2>
                      </div>
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
