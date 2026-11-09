import Link from "next/link";
import { formatDay } from "@/lib/hub/format";
import type { IdeaListRow } from "@/lib/ideas/read";
import type { IdeaReview, ReviewStatus } from "@/lib/ideas/types";
import { focusRing, sticker } from "../styles";

const VERDICT_STYLES: Record<IdeaReview["verdict"], string> = {
  strong: "bg-accent text-night",
  promising: "bg-surface text-accent-ink",
  "needs work": "bg-tea text-night",
  weak: "bg-rose text-night",
};

export function VerdictChip({ verdict }: { verdict: IdeaReview["verdict"] }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border-[1.5px] border-line px-2.5 py-px text-[11px] font-bold whitespace-nowrap ${VERDICT_STYLES[verdict]}`}>
      {verdict}
    </span>
  );
}

const STATUS_MARKS: Partial<Record<ReviewStatus, string>> = {
  waiting: "Review waiting",
  working: "Reviewing now",
  failed: "Review failed",
  paused: "Review paused",
};

export function reviewMark(status: ReviewStatus): string | null {
  return STATUS_MARKS[status] ?? null;
}

export function IdeaRow({ idea }: { idea: IdeaListRow }) {
  const mark = reviewMark(idea.reviewStatus);
  const added = formatDay(idea.createdAt.slice(0, 10));
  const back = idea.nextReturn ? formatDay(idea.nextReturn) : null;
  return (
    <li className={`${sticker} relative bg-surface px-4 py-3.5 transition-[translate] duration-200 ease-spring hover:-translate-y-px sm:px-5`}>
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/hub/ideas/${idea.id}`}
          className={`min-w-0 leading-snug font-medium break-words text-ink after:absolute after:inset-0 ${focusRing}`}
        >
          {idea.title}
        </Link>
        {idea.verdict && <VerdictChip verdict={idea.verdict} />}
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
        {added && <span>Added {added}</span>}
        {idea.mentions > 1 && <span className="font-medium text-ink/80">mentioned {idea.mentions} times</span>}
        {back && <span>Back {back}</span>}
        {mark && (
          <span className={`font-semibold ${idea.reviewStatus === "failed" ? "text-ink" : "text-accent-ink"}`}>{mark}</span>
        )}
      </p>
    </li>
  );
}
