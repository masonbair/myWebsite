import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { HUB_E2E_WORKER_TOKEN, HUB_PORT } from "./hub-ports";
import { ownerDbClient, serviceClient } from "./hub-session";

// Runs only in the "hub" project: the real route, real proxy and local Supabase, driven by bin/hub as the worker would.

const HUB_URL = `http://localhost:${HUB_PORT}`;
const api = `${HUB_URL}/api/hub/worker`;
const headers = { authorization: `Bearer ${HUB_E2E_WORKER_TOKEN}`, "x-hub-run-id": "e2e", "content-type": "application/json" };

async function seedApproved(labels = ["claude"]) {
  const title = `e2e worker ${randomUUID().slice(0, 8)}`;
  const { data, error } = await (await ownerDbClient())
    .from("items")
    .insert({ title, labels, source: "e2e" })
    .select("id, title")
    .single();
  if (error) throw error;
  return data as { id: string; title: string };
}

async function labelsOf(id: string) {
  const { data, error } = await serviceClient().from("items").select("labels").eq("id", id).single();
  if (error) throw error;
  return (data as { labels: string[] }).labels;
}

function hub(args: string[]) {
  const env = { ...process.env, HUB_URL, HUB_WORKER_TOKEN: HUB_E2E_WORKER_TOKEN, NTFY_TOPIC: "unused-in-e2e" };
  return spawnSync("bin/hub", args, { env, encoding: "utf8" });
}

test("bin/hub approved prints the seeded approved item as JSON", async () => {
  const item = await seedApproved();
  const run = hub(["approved"]);
  console.log(`$ HUB_URL=${HUB_URL} bin/hub approved\n${run.stdout}`);
  expect(run.status).toBe(0);
  const listed = JSON.parse(run.stdout) as { id: string; title: string; url: string; updatedAt: string }[];
  expect(listed).toContainEqual(expect.objectContaining({ id: item.id, title: item.title, url: `https://masonbair.com/hub/item/${item.id}` }));
});

test("bin/hub claim wins once, then exits 3", async () => {
  const item = await seedApproved();
  expect(hub(["claim", item.id]).status).toBe(0);
  const second = hub(["claim", item.id]);
  expect(second.status).toBe(3);
  expect(second.stderr).toContain("not claimable");
  expect(await labelsOf(item.id)).toEqual(["claude", "claude-working"]);
});

test("two concurrent claims on the database give one 200 and one 409", async () => {
  const item = await seedApproved();
  const claim = () => fetch(`${api}/item/${item.id}/claim`, { method: "POST", headers, body: "{}" });
  const statuses = (await Promise.all([claim(), claim()])).map((r) => r.status).sort();
  expect(statuses).toEqual([200, 409]);
});

test("finish drops claude on the real database, so the item is not claimable again", async () => {
  const item = await seedApproved(["claude", "todo"]);
  expect((await fetch(`${api}/item/${item.id}/claim`, { method: "POST", headers, body: "{}" })).status).toBe(200);
  const finish = await fetch(`${api}/item/${item.id}/finish`, { method: "POST", headers, body: JSON.stringify({ comment: "Done\nDetails" }) });
  expect(finish.status).toBe(200);
  expect(await labelsOf(item.id)).toEqual(["todo", "claude-done"]);
  expect((await fetch(`${api}/item/${item.id}/claim`, { method: "POST", headers, body: "{}" })).status).toBe(409);
  const readd = await fetch(`${api}/item/${item.id}`, { method: "PATCH", headers, body: JSON.stringify({ labels: ["todo", "claude-done", "claude"] }) });
  expect(readd.status).toBe(403);
});

test("refuses a missing or wrong token", async () => {
  expect((await fetch(`${api}/approved`)).status).toBe(401);
  expect((await fetch(`${api}/approved`, { headers: { ...headers, authorization: "Bearer wrong" } })).status).toBe(401);
});
