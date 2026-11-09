import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { signOut } from "@/app/hub/actions";
import { HubTabs } from "./HubTabs";
import { focusRing } from "./styles";

const quietLink = `inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-mute transition-colors duration-300 ease-spring hover:text-ink hover:underline ${focusRing}`;

export function HubHeader() {
  return (
    <header className="mb-10 flex flex-wrap items-center gap-x-5 gap-y-4">
      <Link href="/hub" className={`inline-flex -rotate-2 rounded-xl border-[2.5px] border-line bg-surface px-3 py-0.5 text-lg font-bold tracking-tight text-ink shadow-sticker-sm ${focusRing}`}>
        Mason&apos;s hub
      </Link>
      <div className="order-last w-full sm:order-none sm:w-auto">
        <HubTabs />
      </div>
      <div className="ml-auto flex items-center">
        <Link href="/hub/analytics" className={quietLink}>
          Stats
        </Link>
        <Link href="/" className={quietLink}>
          Site
          <ArrowUpRight size={13} weight="bold" aria-hidden />
        </Link>
        <form action={signOut}>
          <button type="submit" className={quietLink}>
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
