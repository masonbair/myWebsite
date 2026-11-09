import { describe, expect, it } from "vitest";
import { ForbiddenError, ItemNotOpenError, assertAllowed, assertHubStateKey, assertOpenForEdit } from "@/lib/hub/rules";
import type { Actor, HubAction } from "@/lib/hub/types";

const mason: Actor = { kind: "mason" };
const worker: Actor = { kind: "worker", runId: "run-1" };
const agent: Actor = { kind: "agent", client: "claude-ai" };

const table: Record<HubAction, [boolean, boolean, boolean]> = {
  read: [true, true, true],
  add: [true, true, true],
  update: [true, true, true],
  comment: [true, true, true],
  complete: [true, false, false],
  reopen: [true, false, false],
  archive: [true, true, true],
  claim: [false, true, false],
  "set-status-labels": [false, true, false],
  "hub-state": [false, true, false],
  "memo-files": [false, true, false],
};

describe("assertAllowed", () => {
  for (const [action, [masonOk, workerOk, agentOk]] of Object.entries(table) as [HubAction, boolean[]][]) {
    for (const [name, actor, ok] of [["mason", mason, masonOk], ["worker", worker, workerOk], ["agent", agent, agentOk]] as const) {
      it(`${name} ${ok ? "may" : "may not"} ${action}`, () => {
        if (ok) expect(() => assertAllowed(actor, action)).not.toThrow();
        else expect(() => assertAllowed(actor, action)).toThrow(ForbiddenError);
      });
    }
  }
});

describe("assertOpenForEdit", () => {
  for (const state of ["done", "archived"] as const) {
    it(`lets only Mason change a ${state} item`, () => {
      const item = { id: "i1", state };
      expect(() => assertOpenForEdit(mason, item)).not.toThrow();
      expect(() => assertOpenForEdit(worker, item)).toThrow(ItemNotOpenError);
      expect(() => assertOpenForEdit(agent, item)).toThrow(`item i1 is ${state}`);
    });
  }

  it("lets anyone change an open item", () => {
    for (const actor of [mason, worker, agent]) expect(() => assertOpenForEdit(actor, { id: "i1", state: "open" })).not.toThrow();
  });
});

describe("assertHubStateKey", () => {
  it("allows the Ideas Lab's monthly cap flag, daily failure flag and daily Google-revoked flag", () => {
    expect(() => assertHubStateKey("ideas-cap-notified:2026-11")).not.toThrow();
    expect(() => assertHubStateKey("ideas-failures-notified:2026-11-09")).not.toThrow();
    expect(() => assertHubStateKey("ideas-google-revoked:2026-11-09")).not.toThrow();
  });

  it("refuses look-alike Ideas Lab keys", () => {
    for (const key of ["ideas-cap-notified:", "ideas-cap-notified:2026-11-09", "ideas-failures-notified:2026-11", "ideas-cap-notified:2026-11x", "ideas-google-revoked:2026-11", "ideas-google-revoked:"]) {
      expect(() => assertHubStateKey(key)).toThrow(ForbiddenError);
    }
  });
});
