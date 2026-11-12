import type { LearnReport } from "@/lib/learn/read";
import type { LearnType } from "@/lib/learn/types";
import { focusRing } from "../styles";

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-1 text-[15px] leading-relaxed">{children}</div>
    </div>
  );
}

/** The grader's feedback on one answer, and the minutes it earned. */
export function ReportCard({ report, type }: { report: LearnReport; type: LearnType }) {
  const minutes = report.late ? "+0 min (late)" : `+${report.minutes} min`;
  return (
    <section aria-label="Report card" className="flex flex-col gap-4">
      <div className="rounded-2xl border-[2.5px] border-line bg-accent p-4 text-night shadow-sticker-sm">
        <p className="text-lg font-bold">
          Graded: {report.grade} · {minutes}
        </p>
        {report.jargonOpening && <p className="mt-1 text-sm">You opened with jargon. Lead with the big idea.</p>}
      </div>
      <Part title="What worked">{report.worked}</Part>
      <Part title="What to fix">{report.fix}</Part>
      {report.better && <Part title="A stronger version">{report.better}</Part>}
      {type === "voice" && report.delivery && <Part title="Delivery">{report.delivery}</Part>}
      {report.resources.length > 0 && (
        <Part title="Read next">
          <ul className="flex flex-col gap-1">
            {report.resources.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className={`rounded-sm font-bold text-accent-ink underline ${focusRing}`}>
                  {r.title} ↗
                </a>
              </li>
            ))}
          </ul>
        </Part>
      )}
    </section>
  );
}
