import { handleMemoDone } from "@/lib/hub/memo";

// Outside proxy.ts's matcher, like /api/memo: the uploaders send the memo upload token, not a session cookie.
export function POST(request: Request): Promise<Response> {
  const url = process.env.ROUTINE_FIRE_URL;
  const token = process.env.ROUTINE_FIRE_TOKEN;
  return handleMemoDone(request, {
    token: process.env.MEMO_UPLOAD_TOKEN,
    routine: url && token ? { url, token } : null,
    fetchFn: fetch,
  });
}
