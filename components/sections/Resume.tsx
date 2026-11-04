import { ArrowUpRight, DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import { contact, education, resumeHref, skills } from "@/content/site";
import { Tile } from "../board/Tile";
import { sectionShell } from "./Section";

const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const linkClass = `inline-flex items-center gap-1 rounded-sm font-medium text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink ${focusRing}`;

export function Resume() {
  return (
    <section id="resume" aria-labelledby="resume-title" className={sectionShell}>
      <Tile core="bg-surface p-6 md:p-10 lg:p-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="resume-title" className="text-4xl leading-none font-bold tracking-tighter text-ink md:text-5xl">
            Résumé
          </h2>
          <a
            href={resumeHref}
            download
            className={`group inline-flex items-center gap-3 self-start rounded-full bg-accent-ink py-2 pr-2 pl-6 text-base font-semibold whitespace-nowrap text-snow transition-transform duration-300 ease-spring active:scale-[0.98] sm:self-auto dark:text-night ${focusRing}`}
          >
            Download résumé
            <span className="flex size-9 items-center justify-center rounded-full bg-snow/15 transition-transform duration-300 ease-spring group-hover:translate-y-0.5 dark:bg-night/10">
              <DownloadSimple weight="light" size={18} aria-hidden />
            </span>
          </a>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <h3 className="text-lg font-semibold tracking-tight text-ink">Education</h3>
            <ul className="mt-4 space-y-5">
              {education.map((e) => (
                <li key={e.school}>
                  <p className="font-semibold text-ink">{e.school}</p>
                  <p className="text-mute">{e.detail}</p>
                  <p className="text-sm text-mute">{e.dates}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-8">
            <h3 className="text-lg font-semibold tracking-tight text-ink">Technical skills</h3>
            <dl className="mt-4 grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {skills.map((s) => (
                <div key={s.label}>
                  <dt className="font-semibold text-ink">{s.label}</dt>
                  <dd className="mt-1 leading-relaxed text-mute">{s.items}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-12 border-t border-ink/10 pt-8">
          <h3 className="sr-only">Contact</h3>
          <ul className="flex flex-wrap gap-x-8 gap-y-3">
            <li>
              <a href={`mailto:${contact.email}`} className={linkClass}>
                {contact.email}
              </a>
            </li>
            <li>
              <a href={`tel:+1${contact.phone.replaceAll("-", "")}`} className={linkClass}>
                {contact.phone}
              </a>
            </li>
            <li>
              <a href={contact.github} target="_blank" rel="noopener noreferrer" className={linkClass}>
                github.com/masonbair
                <ArrowUpRight weight="light" size={14} aria-hidden />
              </a>
            </li>
            <li>
              <a href={contact.linkedin} target="_blank" rel="noopener noreferrer" className={linkClass}>
                linkedin.com/in/masonbair
                <ArrowUpRight weight="light" size={14} aria-hidden />
              </a>
            </li>
          </ul>
        </div>
      </Tile>
    </section>
  );
}
