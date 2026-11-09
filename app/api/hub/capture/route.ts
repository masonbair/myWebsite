import { NextResponse, type NextRequest } from "next/server";
import { checkOwner } from "@/lib/auth/require-owner";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { parseCapture, type Capture } from "@/lib/hub/capture";
import { saveCapture } from "@/lib/hub/capture-write";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const owner = await checkOwner();
  if (!owner.ok) {
    return owner.reason === "signed-out"
      ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
      : NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let capture: Capture;
  try {
    capture = parseCapture(await request.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { item, created } = await saveCapture(capture, "capture", { asIdea: capture.asIdea });
  return NextResponse.json({ id: item.id }, { status: created ? 201 : 200 });
}
