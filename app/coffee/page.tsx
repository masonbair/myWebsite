import type { Metadata } from "next";
import Image from "next/image";
import {
  AirplaneTilt,
  ArrowUpRight,
  CalendarPlus,
  Compass,
  GithubLogo,
  GlobeHemisphereWest,
  LinkedinLogo,
  ShieldCheck,
  Trophy,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Reveal } from "@/components/board/Reveal";
import { Prompt, Tile } from "@/components/board/Tile";
import { focusRing, stickerButtonShape, tag } from "@/components/ui/sticker";
import { JsonLd } from "@/components/JsonLd";
import { bookingMailto, bookingUrl, coffee, coffeeUpdated, type TopicIcon } from "@/content/coffee";
import { contact } from "@/content/site";
import { coffeeJsonLd } from "@/lib/jsonld";

export const metadata: Metadata = {
  title: coffee.title,
  description: coffee.description,
  alternates: { canonical: "/coffee" },
  openGraph: { type: "website", siteName: "Mason Bair", title: coffee.heading, description: coffee.description, url: "/coffee" },
};

const topicIcons: Record<TopicIcon, Icon> = {
  shield: ShieldCheck,
  trophy: Trophy,
  compass: Compass,
  plane: AirplaneTilt,
};

const photo = {
  src: "/misc/Mason_traveling.webp",
  alt: "Mason smiling in a red bucket hat and sunglasses, taking a selfie on a roadside with green mountains and a river valley behind him",
};


const updated = new Date(coffeeUpdated);
const updatedLabel = updated.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

const elsewhere = [
  { label: "GitHub", href: contact.github, icon: GithubLogo },
  { label: "LinkedIn", href: contact.linkedin, icon: LinkedinLogo },
];

export default function CoffeePage() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pt-24 pb-24 md:px-8">
      <JsonLd data={coffeeJsonLd()} />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Tile core="flex flex-col bg-tea p-7 text-night md:p-12">
            <Prompt>book --coffee</Prompt>
            <h1 className="mt-2 max-w-[14ch] text-5xl leading-[0.95] font-bold tracking-[-0.04em] md:text-7xl">
              {coffee.heading}
            </h1>
            <div className="mt-6 max-w-[52ch] space-y-1 text-lg leading-relaxed md:text-xl">
              {coffee.bio.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={coffee.bookLabel}
              className={`${stickerButtonShape} mt-8 self-start border-night bg-night text-snow`}
            >
              Book a time
              <span className="flex size-9 items-center justify-center rounded-full bg-snow text-night">
                <CalendarPlus weight="light" size={18} aria-hidden />
              </span>
            </a>
            <p className="mt-4 text-sm font-medium">
              No calendar access?{" "}
              <a href="#book-by-email" className={`font-bold underline underline-offset-4 ${focusRing}`}>
                Book by email
              </a>
            </p>
            <dl className="mt-auto flex flex-wrap gap-x-10 gap-y-4 pt-12">
              {coffee.format.map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-sm font-medium">{label}</dt>
                  <dd className={`${tag} mt-1.5 border-night bg-snow text-sm text-night`}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Tile>
        </div>

        <div className="lg:col-span-5">
          <Tile tilt="right" core="aspect-[4/5] bg-ink/5 lg:aspect-auto lg:min-h-[36rem]">
            <Image
              src={photo.src}
              alt={photo.alt}
              fill
              preload
              sizes="(min-width: 1400px) 540px, (min-width: 1024px) 40vw, calc(100vw - 32px)"
              className="object-cover object-[50%_35%]"
            />
          </Tile>
        </div>

        <Reveal index={2} className="lg:col-span-8">
          <Tile core="bg-surface p-7 md:p-10">
            <h2 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{coffee.topicsHeading}</h2>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2">
              {coffee.topics.map(({ icon, label, detail }) => {
                const TopicGlyph = topicIcons[icon];
                return (
                  <li key={label} className="flex gap-4 rounded-2xl border-[2.5px] border-line bg-canvas p-4 shadow-sticker-sm">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-line bg-accent text-night">
                      <TopicGlyph weight="light" size={22} aria-hidden />
                    </span>
                    <div>
                      <p className="font-semibold text-ink">{label}</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-mute">{detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-10 text-base text-ink">{coffee.audience}</p>
          </Tile>
        </Reveal>

        <Reveal index={3} className="lg:col-span-4">
          <Tile tilt="left" core="flex flex-col bg-accent p-7 text-night md:p-10">
            <GlobeHemisphereWest weight="light" size={40} aria-hidden />
            <h2 className="mt-auto pt-10 text-2xl font-bold tracking-tight md:text-3xl">{coffee.timeZoneHeading}</h2>
            <p className="mt-3 max-w-[36ch] text-base leading-relaxed text-night">{coffee.timeZoneNote}</p>
          </Tile>
        </Reveal>
      </div>

      <section aria-labelledby="niches-title" className="mt-24 md:mt-32">
        <h2 id="niches-title" className="text-4xl leading-none font-bold tracking-[-0.04em] text-ink md:text-5xl">
          {coffee.nichesHeading}
        </h2>
        <div className="mt-10 grid max-w-5xl gap-5 md:grid-cols-2">
          {coffee.niches.map(({ id, heading, body }) => (
            <article key={id} id={id} className="scroll-mt-28 rounded-tile border-[2.5px] border-line bg-surface p-6 shadow-sticker-sm">
              <h3 className="text-xl font-semibold tracking-tight text-ink">
                {heading}
              </h3>
              <div className="mt-3 max-w-[60ch] space-y-3 leading-relaxed text-mute">
                {body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="book-by-email" aria-labelledby="email-title" className="mt-24 scroll-mt-28 md:mt-32">
        <h2 id="email-title" className="text-2xl font-bold tracking-tight text-ink">
          {coffee.emailHeading}
        </h2>
        <ol className="mt-6 max-w-[60ch] list-decimal space-y-2 pl-5 leading-relaxed text-mute">
          {coffee.emailSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <a
          href={bookingMailto}
          className={`mt-6 inline-flex rounded-full border-2 border-line bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-sticker-sm transition-transform duration-200 ease-spring active:translate-x-0.5 active:translate-y-0.5 ${focusRing}`}
        >
          {coffee.emailLink}
        </a>
      </section>

      <section aria-labelledby="faq-title" className="mt-24 md:mt-32">
        <h2 id="faq-title" className="text-4xl leading-none font-bold tracking-[-0.04em] text-ink md:text-5xl">
          {coffee.faqHeading}
        </h2>
        <dl data-testid="faq" className="mt-10 grid max-w-5xl gap-5 md:grid-cols-2">
          {coffee.faqs.map(({ q, a }) => (
            <div key={q} className="rounded-tile border-[2.5px] border-line bg-surface p-6 shadow-sticker-sm">
              <dt className="text-lg font-semibold tracking-tight text-ink">{q}</dt>
              <dd className="mt-2 max-w-[48ch] leading-relaxed text-mute">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="elsewhere-title" className="mt-24 md:mt-32">
        <h2 id="elsewhere-title" className="text-2xl font-bold tracking-tight text-ink">
          {coffee.linksHeading}
        </h2>
        <ul className="mt-6 flex flex-wrap gap-3">
          {elsewhere.map(({ label, href, icon: Glyph }) => (
            <li key={label}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={`group inline-flex items-center gap-2 rounded-full border-2 border-line bg-surface py-2 pr-4 pl-4 text-sm font-semibold text-ink shadow-sticker-sm transition-transform duration-200 ease-spring active:translate-x-0.5 active:translate-y-0.5 ${focusRing}`}
              >
                <Glyph weight="light" size={18} aria-hidden />
                {label}
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
      </section>

      <p className="mt-16 text-sm text-mute">
        Last updated <time dateTime={coffeeUpdated}>{updatedLabel}</time>
      </p>
    </main>
  );
}
