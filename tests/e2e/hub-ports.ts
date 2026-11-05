export const HUB_PORT = 3110;
// A second hub server with HUB_WORKER_LIVE=true, so both states of the Approve button are tested for real.
export const HUB_LIVE_PORT = 3111;
// Only the local hub servers in playwright.config.ts accept this; it is not a secret.
export const HUB_E2E_WORKER_TOKEN = "hub-e2e-worker-token-local-only";
