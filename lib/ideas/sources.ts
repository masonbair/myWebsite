import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelId } from "@/lib/ai/claude";
import { z } from "zod";
import {
  ClaimLost,
  recordingFile,
  recordingRef,
  SAVED_IDEA,
  type DetectKind,
  type MemoIdeas,
  type SavedIdea,
  type SourceKind,
} from "./types";

const MAX_DETECT_ATTEMPTS = 3;
const SOURCE_CANDIDATES = 20;

export type SavedDetection = { ideas: SavedIdea[]; model: ModelId | null };

/** A claimed source; `saved` is the detection a failed earlier run already made, to file from instead of asking again. */
export type ClaimedSource =
  | { itemId: string; kind: SourceKind; saved: SavedDetection | null }
  | { kind: "recording"; file: string; recorded: string; transcript: string; saved: SavedDetection | null };

/** The ref the source methods take: the item id, or `rec:<file>` for a recording. */
export const sourceRef = (source: ClaimedSource) => (source.kind === "recording" ? recordingRef(source.file) : source.itemId);

/** Detection's claims and progress on item sources and HiNote recordings; every method takes a source ref. */
export type SourceStore = {
  /** The quote detection stored for this idea, or null for a typed or saved idea. */
  ideaQuote(id: string): Promise<string | null>;
  /** Takes the oldest pending source of these kinds (item sources before recordings) and counts an attempt; two runs never take the same one. */
  claimSource(kinds: DetectKind[]): Promise<ClaimedSource | null>;
  /** Saves the detected ideas and each one's outcome so far on our claimed source; throws ClaimLost if another run took it. */
  saveIdeas(ref: string, ideas: SavedIdea[], model: ModelId | null): Promise<void>;
  /** Marks our claimed source done with its ideas and their outcomes; throws ClaimLost if another run took it. */
  finishSource(ref: string, ideas: SavedIdea[], model: ModelId | null): Promise<void>;
  /** Records a real failure on the attempt the claim counted: failed on the third, otherwise pending for a later run. */
  failSource(ref: string, code: string): Promise<"pending" | "failed">;
  /** Gives back the claim's attempt after a passing error or the cap, which say nothing about the source. */
  releaseSource(ref: string): Promise<void>;
  /** Whether the Mac already sent this memo's recording read-only, so its ideas were read once already. */
  recordingExists(memoFile: string): Promise<boolean>;
};

type Audit = (action: string, itemId: string | null, detail: Record<string, unknown>) => Promise<void>;

const ITEM = { table: "idea_sources", key: "source_item_id" } as const;
const RECORDING = { table: "idea_recordings", key: "file" } as const;
type Table = typeof ITEM | typeof RECORDING;

function locate(ref: string): { at: Table; key: string } {
  const file = recordingFile(ref);
  return file === null ? { at: ITEM, key: ref } : { at: RECORDING, key: file };
}

type Candidate = { key: string; kind?: SourceKind; attempts: number; quotes: unknown; model: ModelId | null; created_at: string; updated_at: string };

/** The source store over the service client; `leaseMs` is how long a claim keeps other runs off a source. */
export function createSourceStore(client: SupabaseClient, audit: Audit, leaseMs: number): SourceStore & { failedSince(since: Date): Promise<number> } {
  // The updated_at this run's last write set per source, and the attempts its claim counted; each write must still match it.
  const sourceClaims = new Map<string, { stamp: string; attempts: number }>();

  /** One guarded write to our claimed source; a write that leaves it pending keeps the claim with the new stamp. */
  async function updateOwnSource(ref: string, columns: Record<string, unknown>): Promise<void> {
    const held = sourceClaims.get(ref);
    if (!held) throw new ClaimLost(ref);
    const { at, key } = locate(ref);
    const { data, error } = await client
      .from(at.table)
      .update(columns)
      .eq(at.key, key)
      .eq("status", "pending")
      .eq("updated_at", held.stamp)
      .select("updated_at, status");
    if (error) throw error;
    const row = (data as { updated_at: string; status: string }[] | null)?.[0];
    if (!row) throw new ClaimLost(ref);
    if (row.status === "pending") sourceClaims.set(ref, { ...held, stamp: row.updated_at, attempts: (columns.attempts as number) ?? held.attempts });
    else sourceClaims.delete(ref);
  }

  async function claimIn(at: Table, kinds: SourceKind[] | null): Promise<Candidate | null> {
    let query = client
      .from(at.table)
      .select(`${at.key}, attempts, quotes, model, created_at, updated_at${at === ITEM ? ", kind" : ""}`)
      .eq("status", "pending");
    if (kinds) query = query.in("kind", kinds);
    const { data, error } = await query.order("created_at").limit(SOURCE_CANDIDATES);
    if (error) throw error;
    const leaseEnd = Date.now() - leaseMs;
    for (const raw of (data ?? []) as unknown as Record<string, unknown>[]) {
      const row = { ...(raw as Omit<Candidate, "key">), key: raw[at.key] as string };
      const untouched = row.updated_at === row.created_at;
      if (!untouched && Date.parse(row.updated_at) > leaseEnd) continue;
      // A run died holding its third attempt, so the source fails instead of looping on paid calls.
      const exhausted = row.attempts >= MAX_DETECT_ATTEMPTS;
      // The touch trigger moves updated_at, so only the first of two racing runs matches the old value.
      const { data: won, error: claimError } = await client
        .from(at.table)
        .update(exhausted ? { status: "failed", last_error: "stale" } : { attempts: row.attempts + 1 })
        .eq(at.key, row.key)
        .eq("status", "pending")
        .eq("updated_at", row.updated_at)
        .select("updated_at");
      if (claimError) throw claimError;
      const stamp = (won as { updated_at: string }[] | null)?.[0]?.updated_at;
      if (!stamp || exhausted) continue;
      sourceClaims.set(at === ITEM ? row.key : recordingRef(row.key), { stamp, attempts: row.attempts + 1 });
      return row;
    }
    return null;
  }

  const savedOf = (row: Candidate): SavedDetection | null => {
    const ideas = savedIdeas(row.quotes);
    return ideas?.length ? { ideas, model: row.model } : null;
  };

  const ideasColumns = (ideas: SavedIdea[], model: ModelId | null) => ({
    quotes: ideas,
    idea_item_ids: ideas.flatMap((i) => (i.outcome ? [i.outcome.id] : [])),
    model,
  });

  /** Audit rows point at the item; a recording has none, so its file goes in the detail. */
  const auditSource = (action: string, ref: string, detail: Record<string, unknown>) => {
    const file = recordingFile(ref);
    return file === null ? audit(action, ref, detail) : audit(action, null, { recording: file, ...detail });
  };

  async function countFailed(at: Table, since: Date): Promise<number> {
    const { count, error } = await client
      .from(at.table)
      .select("*", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("updated_at", since.toISOString());
    if (error) throw error;
    return count ?? 0;
  }

  return {
    async ideaQuote(id) {
      const rows = await Promise.all(
        [ITEM, RECORDING].map(async (at) => {
          const { data, error } = await client
            .from(at.table)
            .select("quotes, created_at")
            .contains("idea_item_ids", [id])
            .order("created_at")
            .limit(SOURCE_CANDIDATES);
          if (error) throw error;
          return (data ?? []) as { quotes: unknown; created_at: string }[];
        }),
      );
      const entries = rows
        .flat()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .flatMap((row) => savedIdeas(row.quotes) ?? [])
        .filter((i) => i.outcome?.id === id);
      // The source an idea was filed from holds its own words; a later mention is only a repeat.
      return (entries.find((i) => i.outcome?.kind !== "mention") ?? entries[0])?.quote ?? null;
    },

    async claimSource(kinds) {
      const itemKinds = kinds.filter((k): k is SourceKind => k !== "recording");
      const item = itemKinds.length ? await claimIn(ITEM, itemKinds) : null;
      if (item) return { itemId: item.key, kind: item.kind as SourceKind, saved: savedOf(item) };
      if (!kinds.includes("recording")) return null;
      const recording = await claimIn(RECORDING, null);
      if (!recording) return null;
      // Transcripts can be near 1 MB each, so only the claimed one is read.
      const { data, error } = await client.from("idea_recordings").select("recorded, transcript").eq("file", recording.key).single();
      if (error) throw error;
      const { recorded, transcript } = data as { recorded: string; transcript: string };
      return { kind: "recording", file: recording.key, recorded, transcript, saved: savedOf(recording) };
    },

    saveIdeas: (ref, ideas, model) => updateOwnSource(ref, ideasColumns(ideas, model)),

    async finishSource(ref, ideas, model) {
      await updateOwnSource(ref, { status: "done", last_error: null, ...ideasColumns(ideas, model) });
      await auditSource("idea-detect", ref, { ideas: ideas.length, model });
    },

    async failSource(ref, code) {
      const attempts = sourceClaims.get(ref)?.attempts ?? MAX_DETECT_ATTEMPTS;
      const status = attempts >= MAX_DETECT_ATTEMPTS ? "failed" : "pending";
      await updateOwnSource(ref, { status, last_error: code });
      await auditSource("idea-detect-failed", ref, { code, attempts });
      return status;
    },

    async releaseSource(ref) {
      const held = sourceClaims.get(ref);
      if (!held) return;
      await updateOwnSource(ref, { attempts: held.attempts - 1 });
    },

    async recordingExists(memoFile) {
      // hinote-sync names a transcript after the recording's stem, and the memo relay keeps the device file name.
      const names = [...new Set([memoFile, memoFile.replace(/\.[^.]*$/, "")])];
      const { data, error } = await client.from("idea_recordings").select("file").in("file", names).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async failedSince(since) {
      const [items, recordings] = await Promise.all([countFailed(ITEM, since), countFailed(RECORDING, since)]);
      return items + recordings;
    },
  };
}

/** Queues a new memo item for detection; the relay calls it only while IDEAS_MEMO_DETECTION is on. */
export async function queueMemoIdeas(client: SupabaseClient, itemId: string): Promise<void> {
  const { error } = await client
    .from("idea_sources")
    .upsert({ source_item_id: itemId, kind: "memo", status: "pending" }, { onConflict: "source_item_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** For the memo split: any memo with a source row, failed included, has its ideas owned by the Ideas Lab; plus which it filed. */
export async function ideasFiledFrom(client: SupabaseClient, memoIds: string[]): Promise<Map<string, MemoIdeas>> {
  const filed = new Map<string, MemoIdeas>();
  // Ids travel in the URL, so ask in batches that stay well under URL length limits.
  for (let start = 0; start < memoIds.length; start += 100) {
    const batch = memoIds.slice(start, start + 100);
    const { data, error } = await client.from("idea_sources").select("source_item_id, idea_item_ids").in("source_item_id", batch);
    if (error) throw error;
    for (const row of (data ?? []) as { source_item_id: string; idea_item_ids: string[] }[]) {
      // A failed memo waits for Try again; if the worker filed its ideas meanwhile, the retry would file them twice.
      filed.set(row.source_item_id, { owned: true, filed: row.idea_item_ids });
    }
  }
  return filed;
}

/** The saved detection on a source row, or null when there is none in the current shape. */
function savedIdeas(quotes: unknown): SavedIdea[] | null {
  const parsed = z.array(SAVED_IDEA).safeParse(quotes);
  return parsed.success ? parsed.data : null;
}
