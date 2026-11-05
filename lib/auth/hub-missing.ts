import "server-only";
import { redirect } from "next/navigation";

export const HUB_MISSING_PATH = "/hub/missing";

/** Use instead of notFound() in hub pages: a thrown notFound() leaves the page blank when JavaScript is off. */
export function hubMissing(): never {
  redirect(HUB_MISSING_PATH);
}
