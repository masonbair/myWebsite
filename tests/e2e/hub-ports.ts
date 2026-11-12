// HUB_E2E_PORT lets a second worktree run e2e beside the default one.
export const HUB_PORT = Number(process.env.HUB_E2E_PORT ?? 3110);
// A second hub server with HUB_WORKER_LIVE=true, so both states of the Approve button are tested for real.
export const HUB_LIVE_PORT = HUB_PORT + 1;
// Only the local hub servers in playwright.config.ts accept this; it is not a secret.
export const HUB_E2E_WORKER_TOKEN = "hub-e2e-worker-token-local-only";
// Only the local hub servers accept this memo upload token; it is not a secret.
export const HUB_E2E_MEMO_TOKEN = "hub-e2e-memo-token-local-only";
// Only the local hub servers accept this agent connector token; it is not a secret.
export const HUB_E2E_AGENT_TOKEN = "hub-e2e-agent-token-local-only";
// A fake Anthropic API for the learn grader, so e2e never calls Claude.
export const HUB_ANTHROPIC_STUB_PORT = HUB_PORT + 10;
// Only the local hub servers accept these learn tokens; they are not secrets.
export const LEARN_E2E_FOCUSLOCK_TOKEN = "learn-e2e-focuslock-token-local-only";
export const LEARN_E2E_HINOTE_TOKEN = "learn-e2e-hinote-token-local-only";
export const LEARN_E2E_ROUTINE_TOKEN = "learn-e2e-routine-token-local-only";
