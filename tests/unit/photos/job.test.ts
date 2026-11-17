import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError } from "@anthropic-ai/sdk";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LabelError, type PhotoLabel } from "@/lib/photos/label";
import { photoCapUsd, runPhotoLabelJob, type PhotoJobDeps, type PhotoLabelStore } from "@/lib/photos/job";

let jpeg: Uint8Array;
beforeAll(async () => {
  jpeg = new Uint8Array(await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).jpeg().toBuffer());
});

const label: PhotoLabel = { description: "Mason.", kind: "portrait", places: ["slideshow"], score: 6 };
const usage = { input_tokens: 1000, output_tokens: 50 };

function harness(ids: string[], opts: { spend?: number[]; cap?: number } = {}) {
  const saved: string[] = [];
  const failures: [string, string][] = [];
  const usageRows: string[] = [];
  const spends = [...(opts.spend ?? [])];
  const store: PhotoLabelStore = {
    unlabeled: async (limit) => ids.slice(0, limit).map((assetId) => ({ assetId, path: `collector/${assetId}.jpg` })),
    download: async (path) => (path.includes("missing") ? null : jpeg),
    saveLabel: async (id) => void saved.push(id),
    recordFailure: async (id, reason) => void failures.push([id, reason]),
    recordUsage: async (row) => void usageRows.push(row.itemId),
    spend: async () => spends.shift() ?? 0,
  };
  const deps: PhotoJobDeps = {
    store,
    anthropic: {} as Anthropic,
    now: () => new Date("2026-11-17T12:00:00Z"),
    cap: opts.cap ?? 1,
    deadlineMs: 60_000,
    label: vi.fn().mockResolvedValue({ label, usage, model: "claude-haiku-5-5" }),
  };
  return { deps, saved, failures, usageRows };
}

describe("runPhotoLabelJob", () => {
  it("labels each waiting photo and bills it", async () => {
    const h = harness(["a", "b"]);
    expect(await runPhotoLabelJob(h.deps)).toEqual({ labeled: ["a", "b"], failed: [], capped: false });
    expect(h.saved).toEqual(["a", "b"]);
    expect(h.usageRows).toEqual(["a", "b"]);
  });

  it("does nothing without a Claude key", async () => {
    const h = harness(["a"]);
    expect(await runPhotoLabelJob({ ...h.deps, anthropic: null })).toEqual({ labeled: [], failed: [], capped: false });
  });

  it("stops at the monthly cap before spending more", async () => {
    const h = harness(["a", "b", "c"], { spend: [0.5, 1, 1] });
    expect(await runPhotoLabelJob(h.deps)).toEqual({ labeled: ["a"], failed: [], capped: true });
  });

  it("counts a failure that is the photo's fault, and bills a reply it could not use", async () => {
    const h = harness(["missing", "bad"]);
    h.deps.label = vi.fn().mockRejectedValue(new LabelError("schema", { model: "claude-haiku-5-5", usage }));
    expect(await runPhotoLabelJob(h.deps)).toEqual({ labeled: [], failed: ["missing", "bad"], capped: false });
    expect(h.failures).toEqual([
      ["missing", "image"],
      ["bad", "schema"],
    ]);
    expect(h.usageRows).toEqual(["bad"]);
  });

  it("leaves photos waiting, uncounted, when the API is down or busy", async () => {
    for (const e of [new APIConnectionError({ message: "down" }), Object.assign(new Error("busy"), { status: 529 })]) {
      const h = harness(["a", "b"]);
      h.deps.label = vi.fn().mockRejectedValue(e);
      expect(await runPhotoLabelJob(h.deps)).toEqual({ labeled: [], failed: [], capped: false });
      expect(h.failures).toEqual([]);
    }
  });

  it("stops at the deadline", async () => {
    const h = harness(["a", "b"]);
    let t = 0;
    h.deps.now = () => new Date((t += 40_000));
    expect((await runPhotoLabelJob(h.deps)).labeled).toEqual(["a"]);
  });
});

describe("photoCapUsd", () => {
  it("is $1 unless PHOTOS_MONTHLY_BUDGET_USD is a number", () => {
    expect(photoCapUsd({})).toBe(1);
    expect(photoCapUsd({ PHOTOS_MONTHLY_BUDGET_USD: "2.5" })).toBe(2.5);
    expect(photoCapUsd({ PHOTOS_MONTHLY_BUDGET_USD: "0" })).toBe(0);
    expect(photoCapUsd({ PHOTOS_MONTHLY_BUDGET_USD: "lots" })).toBe(1);
    expect(photoCapUsd({ PHOTOS_MONTHLY_BUDGET_USD: "-3" })).toBe(1);
  });
});
