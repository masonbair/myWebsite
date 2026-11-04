import { describe, expect, it } from "vitest";
import { ForbiddenError, assertAllowed } from "@/lib/hub/rules";
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
