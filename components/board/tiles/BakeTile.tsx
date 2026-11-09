import { Cookie } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import type { Bake } from "@/lib/now";
import { timeAgo } from "@/lib/time";
import { Tile } from "../Tile";

export function BakeTile({ bake }: { bake: Bake }) {
  return (
    <Tile tilt="right" core="flex items-stretch gap-5 bg-tea p-6 md:p-7">
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
        <Cookie weight="light" size={28} className="text-night" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-night/80">Last bake</p>
          <p className="mt-1 text-2xl leading-tight font-bold tracking-tight text-night">{bake.name}</p>
          <p className="mt-2 font-mono text-sm text-night/80">{timeAgo(bake.bakedAt)}</p>
        </div>
      </div>
      {bake.photo && (
        <div className="relative w-2/5 shrink-0 overflow-hidden rounded-xl border-2 border-night">
          <Image src={bake.photo} alt={bake.name} fill sizes="(min-width: 1024px) 15vw, 40vw" className="object-cover" />
        </div>
      )}
    </Tile>
  );
}
