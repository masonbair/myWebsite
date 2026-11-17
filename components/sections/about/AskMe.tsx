import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { Prompt, Tile } from "@/components/board/Tile";
import { Section } from "../Section";
import { buttonBubble, stickerButton, tag } from "@/components/ui/sticker";
import { coffeeChat } from "@/content/site";
import { loadNow } from "@/lib/now";
import { buildAnswers, DEFAULT_ANSWER, type Answer, type Fill } from "./answers";
import type { CollectorPhoto } from "@/lib/collector-photos";
import { loadAnswerPhotos } from "./photos";
import { PhotoSticker } from "./PhotoSticker";

const ROOT = "about-ask";

const fills: Record<Fill, { tile: string; prompt: string; body: string; tag: string }> = {
  tea: { tile: "bg-tea text-night", prompt: "", body: "text-night", tag: "border-night bg-snow text-night" },
  accent: { tile: "bg-accent text-night", prompt: "", body: "text-night", tag: "border-night bg-snow text-night" },
  rose: { tile: "bg-rose text-night", prompt: "", body: "text-night", tag: "border-night bg-snow text-night" },
  surface: { tile: "bg-surface text-ink", prompt: "text-accent-ink", body: "text-mute", tag: "border-line bg-canvas text-ink" },
};

/** Pure CSS so the chips work without JavaScript; browsers without :has() show every answer stacked. */
export function answerSwitchCss(ids: string[]): string {
  const shown = ids.map((id) => `#${ROOT}:has(#ask-${id}:checked) [data-ask-answer="${id}"]{display:grid}`).join("");
  return `@supports selector(:has(*)){#${ROOT} [data-ask-answer]{display:none}${shown}}`;
}

function QuestionChip({ answer }: { answer: Answer }) {
  return (
    <label className="inline-flex cursor-pointer items-center rounded-full border-2 border-line bg-surface px-4 py-2 text-[15px] font-semibold text-ink shadow-sticker-sm transition-[translate,box-shadow,background-color] duration-200 ease-spring hover:-translate-y-0.5 has-checked:translate-x-[2px] has-checked:translate-y-[2px] has-checked:bg-accent has-checked:text-night has-checked:shadow-none has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent-ink has-focus-visible:outline-solid motion-reduce:transition-none">
      <input
        type="radio"
        name={ROOT}
        id={`ask-${answer.id}`}
        value={answer.id}
        defaultChecked={answer.id === DEFAULT_ANSWER}
        className="sr-only"
      />
      {answer.question}
    </label>
  );
}

function AnswerSticker({ answer, photo }: { answer: Answer; photo?: CollectorPhoto }) {
  const look = fills[answer.fill];
  return (
    <article
      data-ask-answer={answer.id}
      aria-labelledby={`ask-${answer.id}-title`}
      className="reveal grid items-start [--i:0] md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <Tile core={`flex min-h-[20rem] flex-col p-7 md:min-h-[24rem] md:p-10 ${photo ? "pb-14 md:pr-16" : ""} ${look.tile}`}>
        <Prompt className={look.prompt}>{answer.command}</Prompt>
        <h3 id={`ask-${answer.id}-title`} className="mt-2 text-lg font-semibold tracking-tight">
          {answer.question}
        </h3>
        {answer.big && (
          <p className="mt-5 max-w-[18ch] text-4xl leading-[1.02] font-bold tracking-[-0.04em] md:text-5xl">{answer.big}</p>
        )}
        <p className={`mt-5 max-w-[52ch] text-lg leading-relaxed ${look.body}`}>{answer.body}</p>
        <ul className="mt-auto flex flex-wrap gap-2 pt-8">
          {answer.tags.map((t) => (
            <li key={t} className={`${tag} text-xs ${look.tag}`}>
              {t}
            </li>
          ))}
        </ul>
      </Tile>
      {photo && (
        <div className="relative -mt-10 mr-4 w-3/5 max-w-60 justify-self-end md:mt-12 md:-ml-12 md:mr-0 md:w-60">
          <PhotoSticker photo={photo} />
        </div>
      )}
    </article>
  );
}

/** About as a short Q&A: pick a question chip, and its answer sticker takes the stage. */
export async function AskMe() {
  const answers = buildAnswers(await loadNow());
  const photos = await loadAnswerPhotos(answers.flatMap((a) => (a.photo ? [a.photo] : [])));
  return (
    <Section id="about" title="About me" prompt="ask mason">
      <style>{answerSwitchCss(answers.map((a) => a.id))}</style>
      {/* On phones the answer sits right under the chips; at lg the chips and coffee link share the left column. */}
      <div id={ROOT} className="mt-10 grid gap-10 md:mt-14 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-14">
        <fieldset className="lg:col-span-5">
          <legend className="max-w-[24ch] text-2xl leading-snug font-semibold tracking-tight text-ink md:text-3xl">
            Ask me anything. Well, one of these.
          </legend>
          <div className="mt-6 flex flex-wrap gap-3">
            {answers.map((a) => (
              <QuestionChip key={a.id} answer={a} />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-8 lg:col-span-7 lg:row-span-2">
          {answers.map((a) => (
            <AnswerSticker key={a.id} answer={a} photo={a.photo ? photos.get(a.photo) : undefined} />
          ))}
        </div>
        <div className="lg:col-span-5">
          <p className="text-lg text-mute">Got a question that&apos;s not here? Ask me over coffee.</p>
          <a href={coffeeChat.href} className={`${stickerButton} mt-4`}>
            {coffeeChat.label}
            <span className={buttonBubble}>
              <ArrowUpRight weight="bold" size={16} aria-hidden />
            </span>
          </a>
        </div>
      </div>
    </Section>
  );
}
