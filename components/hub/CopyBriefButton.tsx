"use client";

import { Check, Copy, Warning } from "@phosphor-icons/react";
import { useState } from "react";
import { itemBriefAction } from "@/app/hub/actions";
import { focusRing } from "./styles";

type State = "idle" | "copying" | "copied" | "failed";

// Safari drops clipboard access once the click's turn ends, so the fetch goes inside the ClipboardItem as a promise.
async function copyBrief(id: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    const blob = itemBriefAction(id).then((text) => new Blob([text], { type: "text/plain" }));
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    return;
  }
  await navigator.clipboard.writeText(await itemBriefAction(id));
}

const LABELS: Record<State, string> = {
  idle: "Copy as a task for Claude",
  copying: "Copying",
  copied: "Copied",
  failed: "Copy failed, try again",
};

export function CopyBriefButton({ id, title }: { id: string; title: string }) {
  const [state, setState] = useState<State>("idle");

  async function copy() {
    setState("copying");
    try {
      await copyBrief(id);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  const Icon = state === "copied" ? Check : state === "failed" ? Warning : Copy;
  return (
    <button
      type="button"
      onClick={copy}
      disabled={state === "copying"}
      aria-label={`${LABELS[state]}: ${title}`}
      title={LABELS[state]}
      className={`grid size-11 place-items-center rounded-full text-mute transition-colors duration-200 ease-spring hover:text-ink disabled:opacity-50 ${state === "copied" ? "text-accent-ink" : ""} ${focusRing}`}
    >
      <Icon size={18} weight={state === "idle" || state === "copying" ? "regular" : "bold"} aria-hidden />
      <span role="status" className="sr-only">
        {state === "copied" || state === "failed" ? LABELS[state] : ""}
      </span>
    </button>
  );
}
