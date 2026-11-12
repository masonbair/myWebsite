import { handlePending } from "@/lib/learn/api";
import { supabaseLearnStore } from "@/lib/learn/store";
import { serviceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  return handlePending(request, { token: process.env.LEARN_HINOTE_TOKEN, store: supabaseLearnStore(serviceClient()) });
}
