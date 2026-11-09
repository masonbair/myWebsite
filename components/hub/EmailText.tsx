import { focusRing } from "./styles";
import { linkSegments } from "@/lib/news/email-view";

/** Email text as plain text; only http and https addresses become links, and they open in a new tab. */
export function EmailText({ text }: { text: string }) {
  return (
    <pre className="font-sans text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
      {linkSegments(text).map((s, i) =>
        s.type === "link" ? (
          <a key={i} href={s.value} target="_blank" rel="noreferrer noopener" className={`break-all text-accent-ink underline ${focusRing}`}>
            {s.value}
          </a>
        ) : (
          s.value
        ),
      )}
    </pre>
  );
}
