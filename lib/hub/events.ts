import type { SupabaseClient } from "@supabase/supabase-js";
import { tokenMatches } from "./bearer";
import { CLAUDE_LABEL } from "./rules";
import { notify } from "./notify";
import { offsetMinutesAt } from "./schedule";
import type { IdeasRunResult } from "@/lib/ideas/job";
import type { NewsJobResult } from "@/lib/news/job";
import type { BackupResult } from "./backup";
import type { HubStore, Item } from "./types";

export type RoutineConfig = { url: string; token: string };

/** The newest now_place row's zone and when it was sent. */
export type PlaceZone = { timeZone: string | null; updatedAt: string };

export type EventDeps = {
  token: string | undefined;
  store: () => HubStore;
  now: () => Date;
  /** HUB_TIME_ZONE: the zone due times are read in when the phone sent no recent zone; reminders refuse to run without it. */
  timeZone: string | undefined;
  /** The newest place ping's zone, or null when there is no ping. */
  latestPlaceZone: () => Promise<PlaceZone | null>;
  ntfyTopic: string | undefined;
  /** Null until the cutover sets ROUTINE_FIRE_URL and ROUTINE_FIRE_TOKEN. */
  routine: RoutineConfig | null;
  fetchFn: typeof fetch;
  /** Null when no blob store is connected. */
  backup: (() => Promise<BackupResult>) | null;
  /** One Ideas Lab run; null only in tests that leave it out. */
  ideas?: (() => Promise<IdeasRunResult>) | null;
  /** One news job run; null when the news Claude key is unset. */
  news: (() => Promise<NewsJobResult>) | null;
  /** One Learn to Earn run; null until the learn job is wired or when its Claude key is unset. */
  learn?: (() => Promise<unknown>) | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4096;
const DATED_LIMIT = 1000;
const MINUTE_MS = 60_000;
// Runs every 5 minutes, so 15 gives a failed or late run two more tries; the reminded flag stops repeats.
const REMINDER_WINDOW_MIN = 15;
// pg_cron can start a moment early, so an item due within the next minute counts as due now.
const EARLY_MS = MINUTE_MS;
const BACKUP_STALE_MS = 36 * 60 * MINUTE_MS;
// Past a week the phone has likely stopped pinging, so its last zone says little about where Mason is.
const PLACE_ZONE_MAX_AGE_MS = 7 * 24 * 60 * MINUTE_MS;

const json = (data: unknown, status = 200) => Response.json(data, { status });

export const reminderKey = (id: string) => `reminded:${id}`;

/** The due moment as wall-clock text; the reminder flag stores it so a rescheduled item is reminded again. */
function dueStamp(due: NonNullable<Item["due"]>, time: string): string {
  return `${due.date}T${time.slice(0, 5)}:00`;
}

function dueInstant(stamp: string, timeZone: string): number {
  const wallClock = Date.parse(`${stamp}Z`);
  const guess = wallClock - offsetMinutesAt(timeZone, new Date(wallClock)) * MINUTE_MS;
  return wallClock - offsetMinutesAt(timeZone, new Date(guess)) * MINUTE_MS;
}

/** Open items due in the last `windowMin` minutes (or the next one); `options.reminded` maps item id to its `reminded:<id>` value. */
export function dueReminders(
  items: Item[],
  now: Date,
  windowMin = REMINDER_WINDOW_MIN,
  options: { timeZone?: string; reminded?: ReadonlyMap<string, unknown> } = {},
): Item[] {
  const timeZone = options.timeZone ?? "UTC";
  return items.filter((item) => {
    if (item.state !== "open" || !item.due?.time) return false;
    const stamp = dueStamp(item.due, item.due.time);
    if (options.reminded?.get(item.id) === stamp) return false;
    const age = now.getTime() - dueInstant(stamp, timeZone);
    return age >= -EARLY_MS && age < windowMin * MINUTE_MS;
  });
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone of Mason's latest place ping when it is a week old or less and valid, otherwise `fallback`. */
export function reminderTimeZone(place: PlaceZone | null, fallback: string, now: Date): string {
  const zone = place?.timeZone;
  if (!zone || !isTimeZone(zone)) return fallback;
  const age = now.getTime() - Date.parse(place.updatedAt);
  return age >= 0 && age <= PLACE_ZONE_MAX_AGE_MS ? zone : fallback;
}

/** Reads the newest now_place row's zone through the service client. */
export async function readLatestPlaceZone(client: SupabaseClient): Promise<PlaceZone | null> {
  const { data, error } = await client
    .from("now_place")
    .select("time_zone, updated_at")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<{ time_zone: string | null; updated_at: string }>();
  if (error) throw error;
  return data ? { timeZone: data.time_zone, updatedAt: data.updated_at } : null;
}

const DEFAULT_TIME_ZONE = "America/Denver";

/** Mason's zone now: the latest place ping's, else HUB_TIME_ZONE, else America/Denver; a failed read falls back too. */
export async function masonTimeZone(client: SupabaseClient, now = new Date()): Promise<string> {
  const fallback = process.env.HUB_TIME_ZONE || DEFAULT_TIME_ZONE;
  try {
    return reminderTimeZone(await readLatestPlaceZone(client), fallback, now);
  } catch (e) {
    console.error(`place zone not read: ${errorName(e)}`);
    return fallback;
  }
}

/** An error's code or class name, which never holds item text or secrets. */
export function errorName(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code) return code;
  return e instanceof Error ? e.name : "error";
}

/** Starts the routine through its API trigger, with the same headers todo-hub's relay sends. */
export async function fireRoutine(itemId: string, routine: RoutineConfig, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(routine.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${routine.token}`,
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: `hub-item-id: ${itemId}` }),
  });
  if (!res.ok) throw new Error(`routine fire ${res.status}`);
}

async function sendReminders(deps: EventDeps): Promise<Response> {
  const topic = deps.ntfyTopic;
  if (!topic || !deps.timeZone) return json({ error: "reminders are not configured" }, 503);
  const store = deps.store();
  const now = deps.now();
  const timeZone = reminderTimeZone(await deps.latestPlaceZone(), deps.timeZone, now);
  const dated = await store.listItems({ state: "open", hasDue: true, limit: DATED_LIMIT });
  const inWindow = dueReminders(dated, now, REMINDER_WINDOW_MIN, { timeZone });
  const reminded = new Map<string, unknown>();
  for (const item of inWindow) reminded.set(item.id, await store.getHubState(reminderKey(item.id)));

  const sent: string[] = [];
  const failed: string[] = [];
  for (const item of dueReminders(inWindow, now, REMINDER_WINDOW_MIN, { timeZone, reminded })) {
    const due = item.due!;
    try {
      await notify(topic, { title: item.title, message: `Due ${due.time!.slice(0, 5)}`, clickUrl: item.url }, deps.fetchFn);
    } catch (e) {
      console.error(`reminder failed for ${item.id}: ${(e as Error).message}`);
      failed.push(item.id);
      continue;
    }
    // Flag only after the send, so a failed send is retried while the item is still in the window.
    await store.setHubState(reminderKey(item.id), dueStamp(due, due.time!));
    sent.push(item.id);
  }
  if (failed.length > 0) return json({ reminded: sent, failed }, 502);
  return json({ reminded: sent });
}

async function readItemId(request: Request): Promise<string | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const id = (JSON.parse(text) as { id?: unknown } | null)?.id;
    return typeof id === "string" && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function fireApproved(request: Request, deps: EventDeps): Promise<Response> {
  if (!deps.routine?.url || !deps.routine.token) return json({ error: "the routine is not configured" }, 503);
  const id = await readItemId(request);
  if (!id) return json({ error: "body must be { id: <item id> }" }, 400);
  const item = await deps.store().getItem(id);
  if (!item) return json({ error: `no item ${id}` }, 404);
  // The trigger fires after the change commits, so recheck: a run may have claimed it or Mason may have taken claude off.
  if (item.state !== "open") return json({ fired: false, reason: `item is ${item.state}` });
  if (!item.labels.includes(CLAUDE_LABEL)) return json({ fired: false, reason: "item is not approved" });
  if (item.labels.includes("claude-working")) return json({ fired: false, reason: "a run already has it" });
  try {
    await fireRoutine(item.id, deps.routine, deps.fetchFn);
  } catch (e) {
    console.error(`fire failed for ${item.id}: ${(e as Error).message}`);
    return json({ error: "routine fire failed" }, 502);
  }
  return json({ fired: true });
}

async function backupFailed(deps: EventDeps, reason: string): Promise<Response> {
  console.error(`hub backup failed: ${reason}`);
  if (deps.ntfyTopic) {
    await notify(deps.ntfyTopic, { title: `Hub backup failed: ${reason.slice(0, 120)}`, message: "Check the hub-backup job and the blob store." }, deps.fetchFn).catch(
      (e: unknown) => console.error(`backup alert not sent: ${(e as Error).message}`),
    );
  }
  return json({ error: `backup failed: ${reason}` }, 500);
}

async function backup(deps: EventDeps): Promise<Response> {
  if (!deps.backup) return json({ error: "backup is not configured" }, 503);
  let result: BackupResult;
  try {
    result = await deps.backup();
  } catch (e) {
    return backupFailed(deps, (e as Error).message);
  }
  const newest = result.newestAt ? Date.parse(result.newestAt) : NaN;
  if (!(deps.now().getTime() - newest <= BACKUP_STALE_MS)) {
    return backupFailed(deps, `newest backup is from ${result.newestAt ?? "never"}`);
  }
  return json(result);
}

/** Serves one pg_cron or trigger event; the token is checked here even though the proxy pre-checks the header. */
export async function handleEventRequest(request: Request, event: string, deps: EventDeps): Promise<Response> {
  if (!deps.token) return json({ error: "events are not configured" }, 503);
  if (!tokenMatches(request.headers.get("authorization"), deps.token)) return json({ error: "unauthorized" }, 401);
  try {
    if (event === "reminders") return await sendReminders(deps);
    if (event === "approved") return await fireApproved(request, deps);
    if (event === "backup") return await backup(deps);
    if (event === "ideas") {
      if (!deps.ideas) return json({ error: "ideas are not configured" }, 503);
      return json(await deps.ideas());
    }
    if (event === "news") {
      if (!deps.news) return json({ error: "news is not configured" }, 503);
      return json(await deps.news());
    }
    if (event === "learn") {
      if (!deps.learn) return json({ error: "learn is not configured" }, 503);
      return json(await deps.learn());
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(`hub event ${event} failed: ${errorName(e)}`);
    return json({ error: "server error" }, 500);
  }
}
