import { coffee } from "@/content/coffee";
import { ogImage, ogSize } from "@/lib/og";

export const alt = coffee.heading;
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: "Coffee chat", line: "A 30 minute video call with Mason Bair." });
}
