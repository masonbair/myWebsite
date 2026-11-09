import { panel } from "../styles";

export type Costs = { thisMonth: number; lastMonth: number; reviews: number; reviewCost: number; cap: number };

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** The Ideas Lab's Claude spend against its monthly cap. */
export function CostSummary({ costs }: { costs: Costs }) {
  const perReview = costs.reviews > 0 ? usd(costs.reviewCost / costs.reviews) : null;
  const rows: [string, string][] = [
    ["This month", usd(costs.thisMonth)],
    ["Last month", usd(costs.lastMonth)],
    ["Cost per review", perReview ?? "No reviews yet"],
    ["Monthly cap", usd(costs.cap)],
  ];
  return (
    <section aria-labelledby="ideas-costs" className={`${panel} px-5 py-5`}>
      <h2 id="ideas-costs" className="text-sm font-semibold text-ink">
        Claude cost
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-mute">{label}</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-mute">
        {perReview ? `${costs.reviews} ${costs.reviews === 1 ? "review" : "reviews"} this month. ` : ""}New reviews wait until next month once spend reaches the cap.
      </p>
    </section>
  );
}
