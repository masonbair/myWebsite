import { createLeaderboardHandlers, supabaseStore } from "@/lib/leaderboard-server";

// Built per request so env changes and missing env (503) are picked up without a module cache.
const handlers = () => createLeaderboardHandlers({ store: supabaseStore(), salt: process.env.LEADERBOARD_SALT });

export const GET = () => handlers().GET();
export const POST = (req: Request) => handlers().POST(req);
