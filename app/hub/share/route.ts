import { NextResponse, type NextRequest } from "next/server";
import { checkOwner } from "@/lib/auth/require-owner";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { captureFromShare } from "@/lib/hub/capture";
import { saveCapture } from "@/lib/hub/capture-write";

function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Android's share sheet posts here (manifest share_target); the shared text and link become one inbox item. */
export async function POST(request: NextRequest) {
  // Null Origin is allowed for Android shares; a forged cross-site POST still arrives signed out because the session cookie is SameSite=Lax, and checkOwner() refuses it.
  if (!isSameOriginRequest(request, { allowNullOrigin: true })) return new NextResponse("Forbidden", { status: 403 });
  const owner = await checkOwner();
  if (!owner.ok && owner.reason === "signed-out") return NextResponse.redirect(new URL("/hub/login", request.url), 303);
  if (!owner.ok) return new NextResponse("Not found", { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const shared = captureFromShare({ title: field(form, "title"), text: field(form, "text"), url: field(form, "url") });
  if (!shared.title) return NextResponse.redirect(new URL("/hub/capture", request.url), 303);
  await saveCapture(shared, "share");
  // 303 turns the POST into a GET, so a reload can never post the same share twice.
  return NextResponse.redirect(new URL("/hub/capture?shared=1", request.url), 303);
}
