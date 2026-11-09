import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { Reveal } from "@/components/board/Reveal";
import { Tile } from "@/components/board/Tile";
import { JsonLd } from "@/components/JsonLd";
import { MoveBadge, TonePill, TrendsFooter } from "@/components/trends/TrendList";
import { CountChart, ToneChart } from "@/components/trends/WeeklyChart";
import { siteUrl } from "@/content/site";
import { PERSON_ID } from "@/lib/jsonld";
import { movers, shortDate, topSubjects, weeklySeries } from "@/lib/news/movers";
import { readSubject } from "@/lib/news/public";

export const revalidate = 3600;

// Rendered on first visit and then cached for the hour, since subjects come from the database.
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ kind: string; key: string }> };

const subjectFor = cache(readSubject);
const COVERAGE_SHOWN = 20;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind, key } = await params;
  const subject = await subjectFor(kind, key);
  if (!subject) return {};
  const title = `${subject.label} in newsletters`;
  const description = `How often six newsletters I read covered ${subject.label} each week over the last 12 months, and the tone.`;
  const url = `/trends/${kind}/${key}`;
  return { title, description, alternates: { canonical: url }, openGraph: { type: "website", siteName: "Mason Bair", title, description, url } };
}

export default async function SubjectPage({ params }: Props) {
  const { kind, key } = await params;
  const subject = await subjectFor(kind, key);
  if (!subject) notFound();

  const weeks = weeklySeries(subject.rows, subject.today);
  const yearStories = weeks.reduce((sum, w) => sum + w.stories, 0);
  const [month] = topSubjects(subject.rows, subject.today, subject.kind);
  const mover = movers(subject.rows, subject.today)[0];
  const coverage = subject.coverage.slice(0, COVERAGE_SHOWN);
  const facts = [
    { label: "Stories, last 12 months", value: String(yearStories) },
    { label: "Stories, last 30 days", value: String(month?.stories ?? 0) },
  ];

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pt-24 pb-24 md:px-8">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          url: `${siteUrl}/trends/${subject.kind}/${subject.key}`,
          name: `${subject.label} in newsletters`,
          about: { "@id": PERSON_ID },
        }}
      />

      <Link
        href="/trends"
        className="group inline-flex items-center gap-2 rounded-full bg-ink/5 py-2 pr-4 pl-3 text-sm font-medium text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ArrowLeft weight="light" size={16} aria-hidden className="transition-transform duration-300 ease-spring group-hover:-translate-x-0.5" />
        All trends
      </Link>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Reveal index={0} className="lg:col-span-4">
          <Tile core="flex h-full flex-col bg-surface p-7 md:p-10">
            <p className="text-sm font-medium text-mute">{subject.kind === "topic" ? "Topic" : "Company"}</p>
            <h1 className="mt-2 text-4xl leading-[0.95] font-extrabold tracking-tighter break-words text-ink md:text-5xl">
              {subject.label}
            </h1>
            {subject.ticker && <p className="mt-3 font-mono text-sm text-mute">{subject.ticker}</p>}
            <div className="mt-6 flex flex-col items-start gap-3">
              {mover ? <MoveBadge mover={mover} /> : <span className="text-sm text-mute">Steady this week</span>}
              {month && <TonePill tone={month.tone} />}
            </div>
            <dl className="mt-auto flex flex-wrap gap-x-10 gap-y-4 pt-10">
              {facts.map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-sm text-mute">{label}</dt>
                  <dd className="mt-1 font-mono text-3xl font-medium tracking-tight text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Tile>
        </Reveal>

        <Reveal index={1} className="lg:col-span-8">
          <section aria-labelledby="weekly-title" className="h-full">
            <Tile core="bg-surface p-7 md:p-10">
              <h2 id="weekly-title" className="text-2xl font-bold tracking-tight text-ink">
                Stories per week
              </h2>
              <p className="mt-1 mb-6 text-sm text-mute">Last 12 months. Open the table for exact counts.</p>
              <CountChart weeks={weeks} />
            </Tile>
          </section>
        </Reveal>

        <Reveal index={2} className="lg:col-span-7">
          <section aria-labelledby="tone-title" className="h-full">
            <Tile core="bg-surface p-7 md:p-10">
              <h2 id="tone-title" className="text-2xl font-bold tracking-tight text-ink">
                Tone per week
              </h2>
              <p className="mt-1 mb-5 text-sm text-mute">How positive or negative the coverage read, week by week.</p>
              <ToneChart weeks={weeks} />
            </Tile>
          </section>
        </Reveal>

        <Reveal index={3} className="lg:col-span-5">
          <section aria-labelledby="coverage-title" className="h-full">
            <Tile core="bg-surface p-7 md:p-10">
              <h2 id="coverage-title" className="text-2xl font-bold tracking-tight text-ink">
                Who covered it
              </h2>
              {coverage.length > 0 ? (
                <ul className="mt-5 flex flex-wrap gap-2">
                  {coverage.map((c) => (
                    <li key={`${c.day}-${c.sourceName}`}>
                      <a
                        href={c.publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1.5 rounded-full bg-ink/5 py-1.5 pr-3 pl-3.5 text-sm font-medium text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {`${c.sourceName}, ${shortDate(c.day)}`}
                        <ArrowUpRight
                          weight="light"
                          size={14}
                          aria-hidden
                          className="text-mute transition-transform duration-300 ease-spring group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-mute">No newsletter links for this one yet.</p>
              )}
            </Tile>
          </section>
        </Reveal>
      </div>

      <TrendsFooter />
    </main>
  );
}
