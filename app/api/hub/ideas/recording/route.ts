import { handleRecording, insertRecording } from "@/lib/ideas/recording";
import { serviceClient } from "@/lib/supabase/server";

// The Mac sends a bearer token, not a session cookie, so proxy.ts lets this path through as a machine API.
export function POST(request: Request): Promise<Response> {
  return handleRecording(request, {
    token: process.env.IDEAS_RECORDING_TOKEN,
    insert: (recording) => insertRecording(serviceClient(), recording),
  });
}
