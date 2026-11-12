import { masonTimeZone } from "@/lib/hub/events";
import { handleToday } from "@/lib/learn/api";
import { supabaseLearnStore } from "@/lib/learn/store";
import { serviceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const client = serviceClient();
  return handleToday(request, {
    token: process.env.LEARN_ROUTINE_TOKEN,
    store: supabaseLearnStore(client),
    now: () => new Date(),
    timeZone: await masonTimeZone(client),
  });
}
