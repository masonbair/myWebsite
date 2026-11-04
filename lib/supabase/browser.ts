import { createBrowserClient } from "@supabase/ssr";

/** Acts as the visitor in the browser; the session lives in cookies the server can read. */
export function browserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
