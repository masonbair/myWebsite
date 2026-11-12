import { handleGrants } from "@/lib/learn/api";
import { supabaseLearnStore } from "@/lib/learn/store";
import { serviceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  return handleGrants(request, { token: process.env.LEARN_FOCUSLOCK_TOKEN, store: supabaseLearnStore(serviceClient()) });
}
