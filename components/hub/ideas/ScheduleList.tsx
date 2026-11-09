import { formatDay } from "@/lib/hub/format";
import type { IdeaPageSettings, IdeaReturn } from "@/lib/ideas/read";

const STEP_NAMES: Record<number, string> = { 1: "After 3 days", 2: "After 2 weeks", 3: "After 2 months" };
const STATUS_NAMES: Record<IdeaReturn["status"], string> = {
  planned: "Planned",
  sent: "On your calendar",
  closed: "Closed",
  skipped: "Skipped",
};

export function ScheduleList({ schedule, settings }: { schedule: IdeaReturn[]; settings: IdeaPageSettings | null }) {
  const stoppedOn = settings?.remindersStoppedAt ? formatDay(settings.remindersStoppedAt.slice(0, 10)) : null;
  return (
    <div className="px-1">
      {stoppedOn && <p className="mb-3 text-sm text-mute">Reminders stopped on {stoppedOn}. It will not come back.</p>}
      {schedule.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {schedule.map((step) => (
            <li key={`${step.step}-${step.dueDate}`} className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-2xl border-2 border-line bg-surface px-4 py-2.5 text-sm">
              <span className="text-ink">
                {STEP_NAMES[step.step] ?? `Return ${step.step}`}
                <span className="text-mute">, {formatDay(step.dueDate)}</span>
              </span>
              <span className={step.status === "planned" || step.status === "sent" ? "font-semibold text-accent-ink" : "text-mute"}>
                {STATUS_NAMES[step.status]}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        !stoppedOn && (
          <p className="text-sm text-mute">
            {settings?.enrolled
              ? "No returns planned yet. They are set after the review."
              : "Not on the return schedule. Ask for a review to start one."}
          </p>
        )
      )}
    </div>
  );
}
