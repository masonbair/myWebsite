import { OAuthError, register } from "@/lib/hub/oauth";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    return Response.json(register(body), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (!(e instanceof OAuthError)) throw e;
    return Response.json({ error: e.code, error_description: e.message }, { status: e.status });
  }
}
