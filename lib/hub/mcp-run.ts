import { ForbiddenError } from "./rules";

export class ToolError extends Error {}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export async function run(work: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await work(), null, 2) }] };
  } catch (e) {
    const shown = e instanceof ForbiddenError || e instanceof ToolError;
    if (!shown) console.error("hub mcp tool failed", e);
    return { isError: true, content: [{ type: "text", text: shown ? (e as Error).message : "the hub could not do that" }] };
  }
}
