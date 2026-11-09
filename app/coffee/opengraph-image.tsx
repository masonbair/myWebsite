import { coffee } from "@/content/coffee";
import { ogImage, ogSize } from "@/lib/og";

export const alt = coffee.heading;
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: "Coffee chat", line: "30 minutes, free, and I'd love to learn from you." });
}
